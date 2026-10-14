---
type: regis-review-report
run_id: 2026-10-14-1330
variant: reduzido (4 de 8 QAs, escolhidos pelo risco)
scope: delta da branch feat/sispag-sugestao-boleto-dda (origin/main 7c59eaa → v0.66.0), feature ADR-0068
qas: [security, fault-tolerance, testability, performance]
total_p0: 0
total_p1: 3
---

# Regis-Review reduzido — sispag-sugestao-boleto-dda — 2026-10-14-1330

> **Escopo.** Só o delta da feature (≈ 20 commits: migration 0084, motor de sugestão, serviço,
> 6 rotas, UI na aba de títulos). Versão reduzida a pedido: **Security, Fault Tolerance,
> Testability e Performance**; Availability, Deployability, Integrability e Modifiability ficaram de
> fora (PatternGuardian, migration aditiva e gate de complexidade do lint cobrem o essencial).
> Os relatórios por QA estão na mesma pasta; este arquivo foi escrito pelo orquestrador (não há
> consolidador na versão reduzida).

## Veredito

**Nenhum P0.** Três P1, nenhum bloqueia o merge por severidade, mas dois mudam o que o usuário
vive e merecem decisão antes de abrir o PR (FT-1 e PERF-1).

| QA | Score | P0 | P1 | P2 | P3 | Achado principal |
|---|---|---|---|---|---|---|
| Security | 7,5 | 0 | 0 | 4 | 1 | `GET /boletos-dda` entrega a linha digitável a `ver` sem auditoria nem limiter (estado conhecido e aceito); `motivo` livre pode receber uma linha colada numa tabela append-only |
| Fault Tolerance | 7,5 | 0 | 1 | 4 | 3 | **FT-1:** decisão `CONFIRMADA` não tem saída; revogar o par não a cancela (a ontologia Q-E diz que cancela) |
| Testability | 8,0 | 0 | 1 | 3 | 1 | **TEST-1:** 2 `buscarPorChave` só testados com linhas mockadas (0 de 2 com integração) |
| Performance | 6,0 | 0 | 1 | 4 | 0 | **PERF-1:** o motor roda inteiro a cada chamada, sem cache; cada carga da página custa de 3 a 11 execuções |

## Os três P1

### FT-1 — uma confirmação por título não tem como ser desfeita (fault-tolerance-1)
- **Medido:** 0 transições saindo de `CONFIRMADA`; nenhum UPDATE/DELETE em
  `sispag_decisao_sugestao_boleto` fora de testes (`SugestaoBoletoRepository.ts:237-243`,
  `BoletoSuggestionService.ts:172-183`).
- **Efeito:** a analista que confirma o boleto errado para um título não consegue corrigir; o título
  passa a responder 409 "já tem um boleto confirmado" e o boleto fica preso no índice único,
  bloqueado para outros títulos. Se o boleto sai do pool, o ERP o vincula ou o título é pago, a
  decisão some da lista em silêncio (`MotorSugestaoBoleto.ts:136-147`).
- **Divergência com a ontologia:** Q-E (ADR-0068) diz "revogar o par cancela as decisões ainda não
  aplicadas"; o código só revoga o par.
- **Por que P1 e não P0:** o passo 1 não escreve no ERP; é evidência. O dano é de usabilidade e de
  trilha, não de dinheiro.

### PERF-1 — o motor roda inteiro a cada chamada e bloqueia o event loop (performance-1)
- **Medido (sintético, local):** 1100 títulos × 6000 boletos: 412–464 ms com 400 valores distintos;
  ~1,0 s com 100; ~4,4 s com 25 (valores repetidos). Custo = títulos × boletos na faixa de valor.
- **Efeito:** `listarSugestoes` executa o motor e só depois corta a página; o front pagina de 100 em
  100 em série, então uma carga da página custa de 3 a 11 execuções (**estimado** ≈ 1,2 s a 4,6 s
  bloqueando o Express **para todas as rotas**). Cada confirmar/rejeitar refaz tudo.
- **Alcance:** a carga acontece em toda abertura da página SISPAG, não só na aba de sugestões.

### TEST-1 — duas leituras de reconfirmação sem teste em banco real (testability-1)
- `TituloAPagarRepository.buscarPorChave` e `BoletoDdaRepository.buscarPorChave` só têm teste com
  linhas mockadas (0/2 com integração). É a mesma classe de falha que já ocorreu neste ciclo
  (SELECT sem a coluna nova, teste mockado passou).

## O que está bem

- 6 rotas com `exigirPermissao` (3 `ver`, 3 `executar`); corpos Zod `.strict()` (um `ator` no corpo
  dá 400); ator só do JWT; SQL 100% parametrizado.
- Cópia da linha digitável **fail-closed**: o evento `LINHA_COPIADA` é gravado antes de devolver a
  linha; falha de auditoria → 503 sem linha; `Cache-Control: no-store`.
- Trigger append-only barra UPDATE/DELETE/TRUNCATE nos eventos; nenhuma coluna guarda barras ou
  linha completas (CHECK + teste).
- Corridas de inserção resolvidas por `ON CONFLICT DO NOTHING` + releitura; índices únicos parciais
  por título, por boleto e por par rejeitado; revogação com lock otimista por `versao`.
- Listagens que atingem o teto de 10 000 linhas **falham alto** (503), não truncam em silêncio.
- Limites nas bordas testados (R$ 0,05 × 0,06; +1…+5 × +6 dias; antes da data de débito; virada de
  mês; empate independente da ordem). Zero escritas no Conexos provadas por spy.
- Cobertura de linhas do delta: Regra 100%, CodigoBarras 100%, Motor 99,3%, Consolidação 98,9%,
  Service 95,7%, Repositório 92,3%, rotas 91,4%; front 92–100%.
- Gate ground-truth: 0 divergem; amostra cega 80 títulos / 31 credores, 56 reproduzem.

## Limitações

- Tempos de Performance são **sintéticos/estimados**; o tamanho real do pool e a latência do banco
  não foram medidos. O bundle do front não foi medido (módulo `@radix-ui/react-dropdown-menu`
  ausente no `node_modules` compartilhado).
- Os 24 testes SQL não rodam no `npm test` local; o CI (`backend-sql`) os executa.
- O gate ground-truth só enxerga títulos já flagados pelo ERP (valor e dia iguais por construção);
  não exercita centavos, 1–5 dias, ATENCAO nem VENCIDO_INFORMATIVO.
- Número de decisões `CONFIRMADA` órfãs em PRD: não medível (passo 1 ainda não rodou).

## Segue o pipeline

P0 = 0 → sem sub-loop obrigatório. P1/P2/P3 estão em
`ontology/_inbox/sispag-sugestao-boleto-dda-regis-followups.md`.
