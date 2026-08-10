# Regis-Review (reduzido) — follow-ups de `fix-recebimentos-tipo`

Executado em 2026-08-10 sobre o delta da branch `worktree-fix-recebimentos-tipo`, escopo restrito
aos arquivos tocados. **Versão reduzida a pedido do Yuri: 4 QAs** (security, fault-tolerance,
testability, modifiability) em vez das 8, sem `qa-consolidator` — por isso não há `REPORT.md`/
`KANBAN.md`; os findings estão aqui.

**Nenhum P0.** Três findings foram remediados no próprio ciclo (abaixo); o resto é follow-up e
**não** foi implementado.

## Remediados neste PR (não são follow-up)

| Origem | Finding | O que foi feito |
|---|---|---|
| qa-security P1 | `EnvironmentProvider` tinha `['COLUMBIA TRADING']` hardcoded como default — viola Regra Inviolável #2 e, no 2º tenant, esconderia crédito alheio com o nome do 1º cliente | Default virou `[]` (detecção desligada sem configuração); `.env.example` passa a trazer a env preenchida |
| qa-modifiability P1 + qa-testability P1 + qa-fault-tolerance F1/F2 | Regra duplicada em TS e no SQL do backfill, já divergentes (SQL sem NFD, sem env, com literal de tenant) | Backfill SQL **removido**. A reclassificação passa a ser do `upsertMany` + cron horário — uma fonte executável só |
| qa-fault-tolerance F4 + qa-testability P3 | `alvo.includes(titular)` casava substring: `COLUMBIA` esconderia `COLUMBIANA S/A` | Casamento por palavra inteira + piso de 6 caracteres por titular, com testes adversariais |

## Follow-ups (NÃO implementados)

### P1 — `card-01` — Analista não tem como ver o que foi escondido
`qa-fault-tolerance F3`. O backend aceita `?incluirTesouraria=true`
(`src/backend/routes/recebimentos.ts`), mas o painel não expõe o toggle — `grep -i incluirTesouraria
src/frontend/app/recebimentos/` devolve zero. Se a classificação errar, a linha some e o caminho de
recuperação é editar URL na mão ou rodar SQL.

O buraco é **pré-existente** (vale igual para `CATEGORIAS_TESOURARIA`), mas este PR aumenta a
superfície do que some sozinho. **É o follow-up mais importante da lista.** A `main` nova já trouxe
a aba de arquivadas — o toggle de tesouraria/transferência interna deveria seguir o mesmo padrão.

### P1 — `card-02` — Cláusula nova do repositório sem asserção
`qa-testability P1`. `TransacaoRepository.buildFiltro` passou a empurrar
`transferencia_interna = FALSE` por default e nenhum teste exige isso; o teste existente usa
`toContain` e continuaria verde se alguém removesse o filtro. Falta também o caso
`incluirTransferenciasInternas: true` e a propagação em `RecebimentosPainelService`
(que amarra a flag ao `incluirTesouraria` — decisão frágil e sem teste).

### P1 — `card-03` — `resolveTitularesInternos` sem cobertura
`qa-testability P1`. Três semânticas não triviais: ausente → `[]`, vazio → `[]`, CSV com espaços →
trim + filter. Nenhuma testada.

### P2 — `card-04` — `CATEGORIA_TRANSFERENCIA_INTERBANCARIA` no lugar errado
`qa-modifiability P2`. O padrão do repo para código de `exiEspCategoria` é
`domain/interface/recebimentos/constants.ts`, onde vive `CATEGORIAS_TESOURARIA`. O `'209'` ficou em
`normalizarLancamento.ts` e reaparece como literal nos testes.

### P2 — `card-05` — `normalizarLinhaXlsx` sem arquivo de teste
`qa-testability P2`. `descreverConta` tem 4 ramos e o `transferenciaInterna: false` do canal xlsx é
decisão explícita — nada disso tem asserção. O arquivo nunca teve `.test.ts`.

### P2 — `card-06` — Propagação no `IngestaoTransacoesService` sem teste
`qa-testability P2`. O mock de env no teste não inclui `recebimentoTitularesInternos`, então o
service passa `undefined`, o `?? []` acomoda e a detecção fica desligada nos testes sem ninguém notar.

### P2 — `card-07` — Célula "Conta" testa o cabeçalho, não o fallback
`qa-testability P2`. `t.contaDescricao ?? (t.gerNum != null ? \`Conta ${t.gerNum}\` : '—')` tem três
ramos; o fixture não popula `contaDescricao`, então só o do meio roda.

### P2 — `card-08` — Reclassificação silenciosa na reingestão
`qa-fault-tolerance F6`. Mudar `RECEBIMENTO_TITULARES_INTERNOS` faz a próxima run esconder N linhas
que o analista estava vendo, sem log, sem contagem na resposta da ingestão, sem trilha. O escopo está
limitado a `status = importada` (correto), mas falta observabilidade.

### P3 — `card-09` — Sem métrica de quantas linhas foram escondidas
`qa-fault-tolerance F7`. A ingestão conta `lidas/inseridas/deduplicadas` e não quantas viraram
transferência interna. Sem isso, uma onda acidental de hides não gera alerta.

### P3 — `card-10` — `RUIDO_STATUS` tem 15 entradas e 5 testadas
`qa-testability P3`. Risco de entrada morta ou, pior, falso positivo — `'CONTA'` sozinha pode
esconder histórico legítimo.

### P3 — `card-11` — Tipo `CarteiraFilter` não nomeado
`qa-modifiability P3`. `incluirTransferenciasInternas` foi o 4º campo repetido em 4 assinaturas de
`TransacaoRepository`. Cada nova exceção de filtro custa 4 edições.

### P3 — `card-12` — `ingerirConta` resolve env por conta
`qa-modifiability P3`. `EnvironmentProvider` é singleton memoizado, então não é perf — é shape: o
contexto de normalização deveria ser montado uma vez em `executar` e descer pronto.

### P3 — `card-13` — `normalizarLancamento.ts` cresceu para ~300 LOC
`qa-modifiability P3`. Ainda abaixo do teto de 400, mas já acumula extração de contraparte,
extração de remetente, canonização, predicado de transferência interna e orquestração. Split
sugerido quando passar do teto: `extratoContraparte.ts` + `classificacaoLancamento.ts`.
