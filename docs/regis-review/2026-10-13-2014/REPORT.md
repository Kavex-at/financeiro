---
type: regis-review-report
run_id: 2026-10-13-2014
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (8 QAs)
scope: delta da branch worktree-sispag-dda-na-ingestao (5a17d3e..HEAD, v0.64.0 -> v0.65.0), NÃO o repositório inteiro
total_cards: 30
total_p0: 0
total_p1: 0
total_p2: 22
total_p3: 8
overall_score: 7.65
---

# Regis-Review — financeiro — 2026-10-13-2014

> **Escopo.** Delta da feature `sispag-dda-na-ingestao` (3 commits, 26 arquivos, +592/−39; ADR-0067):
> `IngestaoPagamentosService.runIngestion` passa a chamar `BoletoDdaService.sincronizar` (pool DDA,
> `fin124`) **antes** de ler os títulos, com prazo de 60 s; nova coluna `titulo_a_pagar.doc_esp_numero`
> (migration 0083); aviso de pool parado > 8 h na aba "Boletos DDA". O score mede a mudança, não a
> dívida legada. Este relatório foi condensado pelo orquestrador a partir da síntese do
> `qa-consolidator` (que não pôde gravar o arquivo); os cards completos estão em `KANBAN.md` e os
> achados por QA nos 8 arquivos da pasta.

## Veredito

1. **Nenhum P0 e nenhum P1** em qualquer dos 8 QAs. A decisão que move dinheiro (remessa) relê o título
   ao vivo no `fin064` e **não lê** `boleto_dda` (RemessaService ~1030–1080, ADR-0040): pool velho ou
   parcial não move dinheiro errado.
2. **30 cards (22 P2, 8 P3)**, ~23 itens de trabalho após fusão: 5 causas-raiz se repetem em 3–4 QAs.
3. O ruído mais barato de corrigir é o **aviso de 8 h**, que dispara com o pipeline saudável por ~7 h
   por dia útil (vão 16h→07h = 15 h) e em segundas cedo.

## Scorecard

Pesos (financeiro; soma 9,0): Security 1,5 · Fault Tolerance 1,3 · Availability 1,2 · Modifiability 1,2 ·
Testability 1,0 · Performance 1,0 · Integrability 0,9 · Deployability 0,9.

| QA | Score | P2 | P3 | Top finding |
|---|---|---|---|---|
| Security | 8,0 | 1 | 1 | erro da sync DDA persistido/logado/exposto sem `redactErrorMessage` (4 saídas, 0 redigidas) |
| Fault Tolerance | 8,0 | 3 | 1 | arquivo DDA com parse vazio/ilegível apaga os boletos existentes (`DELETE … NOT ANY('{}')`) |
| Deployability | 8,0 | 1 | 1 | comportamento novo sem kill-switch (desligar exige commit+merge+deploy) |
| Availability | 7,5 | 2 | 1 | prazo de 60 s não é teto rígido da fase DDA |
| Modifiability | 7,5 | 2 | 2 | limiar de 8 h desacoplado da cadência dos crons |
| Testability | 7,5 | 4 | 2 | UPSERT/COALESCE de `titulo_a_pagar` nunca executa contra Postgres; `ingest-pagamentos.ts` 0% |
| Integrability | 7,5 | 5 | 0 | pool PG 5/5 com sync aninhada; contrato `dda` não tipado no frontend |
| Performance | 7,0 | 4 | 0 | ~40 releituras de arquivo por sync; teto "60 s" só no papel |
| **Overall** | **7,65** | **22** | **8** | |

Rótulos: tempos de Performance são **estimativas** sobre constantes do código e números das notas do repo
(~173 arquivos, ~25k boletos, ~40 na janela de 60 d); o único tempo observado é ~10 s da ingestão no cron.

## Causas-raiz cross-QA (uma correção cada)

| # | Causa | QAs | Cards |
|---|---|---|---|
| CC-1 | O prazo de 60 s é checado só ao **iniciar** cada arquivo; `listarArquivos`, as 3 leituras em voo e os retries (40 s × 3) ficam de fora; a abertura de tela espera por tudo (derivado: ~3 min teórico) | Availability, Performance, Fault Tolerance, Integrability, Deployability | availability-1 = performance-3 = fault-tolerance-1; deployability-1; modifiability-4; testability-2 |
| CC-2 | Folga do pool PG = 0 na fase DDA: 2 conexões de lock + 3 `salvarArquivo` = 5/5 (`poolMaxConnections = 5`, acquire 5 s). Sem deadlock (locks `pg_try_advisory_lock`, ordem fixa) | Performance, Fault Tolerance, Integrability | performance-4 = fault-tolerance-2 = integrability-3 |
| CC-3 | Estado e duração da fase DDA só existem em trânsito ou em texto de `error_message`; `ocupada` é silencioso; nenhuma medida para calibrar o prazo | Availability, Performance, Fault Tolerance, Integrability | performance-1 = availability-2; fault-tolerance-4; integrability-5; availability-3 |
| CC-4 | Limiar de 8 h no frontend vs crons 07h/12h/16h: ~7 h/dia útil de falso aviso; teste fixa o falso positivo de segunda | Modifiability, Integrability, Testability | modifiability-3 = integrability-2; testability-6 |
| CC-5 | Substituição destrutiva por parse vazio/tolerante (`safeParse` descarta linhas; `strOpt` com `.catch(undefined)` mascara deriva de `docEspNumero`), agora automática ≥ 3x/dia | Fault Tolerance, Integrability, Testability | fault-tolerance-3 |
| CC-6 | A camada que mostra o sinal ao operador não acompanha o backend (0/3 campos novos tipados; saída do job a 0%) | Integrability, Modifiability, Testability, Security | integrability-1; modifiability-2; testability-3; security-2 |

## O que está bem

1. A decisão que move dinheiro não depende do pool DDA (validação ao vivo no envio).
2. Falha, lock ocupado e prazo estourado nunca derrubam a ingestão (`sincronizado|parcial|ocupada|falhou`).
3. 1 transação por arquivo DDA; upsert idempotente; `COALESCE` preserva `doc_esp_numero`.
4. Sem deadlock possível; unlock em `finally`.
5. Segurança do delta limpa: SQL parametrizado, 0 rotas novas, 0 escritas novas no ERP.
6. Migration 0083 aditiva e ordenada (`migrate` antes do job em 8 workflows; `copy-to-dist` leva o `.sql`);
   versões FE == BE == 0.65.0; CHANGELOG, ontologia 0.39.2 e ADR-0067 consistentes; rollback = redeploy.
7. Sync DDA e leitura de títulos sequenciais (respeita o cap de sessões do robô, ADR-0066 §3).
8. `runIngestion` 31 → 20 de complexidade; 230 suites / 4081 testes verdes; cobertura do serviço
   99,28% linhas / 89,39% branches.

## Limitações

- Não medíveis localmente: duração real da fase DDA (p50/p95), latência do `fin124`, taxa de
  `parcial/falhou/ocupada`, contenção real do pool, duração do 1º run pós-deploy (pool parado desde 08/10).
- `infra/` não existe: IAM, CloudTrail, SSM, Terraform, `npm audit` não aplicáveis (nenhuma dependência nova).
- Frontend: 1 erro de typecheck e 2 suítes falhando por `@radix-ui/react-dropdown-menu` ausente no
  `node_modules` compartilhado (ambiental, fora do delta).
- As cifras do falso alerta de segunda cedo divergem entre agentes (~41 h, ~63 h, fixture 40 h); o
  ~7 h/dia útil é derivado do calendário e consistente. Confirmar contra o workflow antes de citar.
- Os tetos-alvo da fase DDA divergem entre cards (65 s vs 90 s): decisão a tomar, não erro.

## Ações recomendadas (nada bloqueia o merge)

1. **No merge:** runbook do 1º dia (deployability-2): `parcial` e aviso em `error_message` são esperados
   enquanto o pool, parado desde 08/10, converge; rollback = redeploy 0.64.0 (a coluna fica, inócua).
2. **PR único de contenção da fase DDA (todos S):** teto rígido (availability-1), folga do pool
   (fault-tolerance-2), guarda contra wipe (fault-tolerance-3), redação de erro (security-1), teste do
   prazo no meio da passada (testability-2).
3. **Instrumentar e decidir:** `dda_estado`/`dda_duracao_ms` na run (performance-1 + availability-2); em
   paralelo, decisão de Operações sobre cadência e segunda cedo, e então modifiability-3 / testability-6.
4. **Com dados:** performance-2 (pular arquivos recém-sincronizados; ordenar por `sincronizado_em`),
   fault-tolerance-4 (alerta server-side), availability-3, deployability-1 + modifiability-4.
5. **Contrato e testes:** integrability-1, testability-3, modifiability-2, testability-4, testability-1,
   modifiability-1, integrability-4, integrability-5; testability-5 por último.
