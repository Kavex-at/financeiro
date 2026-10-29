# Follow-ups do Regis-Review — sispag-grupo-na-carteira (emenda 2026-10-29 da ADR-0077, I21v/I21w)

Revisão reduzida de 2026-10-29 (4 QAs: Fault Tolerance, Modifiability, Security, Testability), só o delta sobre
`adfaf786` (v0.78.0). **P0 = 0**: nada re-entra no loop. Relatório e cards completos em
`docs/regis-review/2026-10-29-sispag-grupo-na-carteira/` (`REPORT.md`, `KANBAN.md`). Score ponderado 7.3.

## Já resolvidos neste PR (depois da revisão)
- [x] **testability-2** — `listTitulosEmLotesComprometidos` lido por `comprometidosOuNenhum`: falha desliga só a
  sugestão de grupo, a listagem segue (teste de rejeição).
- [x] **testability-1** — teste do catch de `gruposSugeridos` (o motor de grupos lança).
- [x] **testability-3** — `ORFA` e `EM_GRUPO` mantêm a situação e só ganham o ponteiro (teste de caracterização).
- [x] **testability-5** — teste da falha das marcas renomeado para o ramo que exercita.
- [x] **fault-tolerance-2** — os três warns de fallback levam o código do driver (`codigoDoErro`).

## P1
- [ ] **modifiability-1** — fatiar `BoletoSuggestionService` (1.477 LOC, 17 injeções) em agregador + extratores de
  cenário antes da próxima feature SISPAG que o toque. Soma com `modifiability-1` do review de 2026-10-27.

## P2
- [ ] **fault-tolerance-1 / security-1** (mesmo risco, deduplicado) — quando a leitura de marcas, de lotes
  comprometidos ou o motor de grupos falha, a sugestão de grupo some em silêncio e o 409 do 1:1 sobre o boleto do
  grupo deixa de valer (volta ao comportamento de antes desta emenda). Hoje só `warn`; pedir alarme/métrica.
- [ ] **security-2** — `listAtivos`/`listTitulosEmLotesComprometidos` sem escopo por filial do usuário (débito
  pré-existente; o delta só acrescenta o ponteiro `grupoSugerido` ao mesmo conjunto). Junto com o RBAC do roadmap.
- [ ] **modifiability-2** — tirar a reconciliação grupo × 1:1 de dentro do `MotorSugestaoBoleto` (1.374 LOC).
- [ ] **modifiability-3** — nomear/isolar a regra "sugestão de grupo não tira 1:1 seguro de título de fora"
  (`sugestoesValidas`) e logar quando ela dispara.
- [ ] **testability-4** — teste de integração do aviso de seleção (título de grupo sugerido) no painel (`page.tsx`).

## P3
- [ ] **fault-tolerance-3** — `totalCandidatos` fica 0 no `GRUPO_SUGERIDO` (os fracos saem antes da contagem).
- [ ] **modifiability-4** — centralizar os mapas `Record<SituacaoSugestaoTitulo, …>` (6 edições por situação nova)
  com teste de exaustividade.
- [ ] **modifiability-5** — expor `sugestaoGrupoDegradada` no payload da listagem.
- [x] **copy-gaveta** (QA manual 2026-10-29) — resolvido: com o grupo em cima e sem candidato individual, a gaveta
  não mostra a seção "Sugestão de boleto", o parágrafo "Confirmar aqui…" nem "Nenhum boleto DDA com este valor";
  o bloco do grupo traz uma linha "não grava nada no Conexos".
- [ ] **aviso-grupo-bloqueado** (entrevista, pergunta 4) — aviso no título irmão quando uma decisão 1:1 já
  confirmada ocupa o boleto do grupo ("anule para compor").

## Outros gates
- PatternGuardian: PASS. DesignSystemReviewer: 1 apontamento pré-existente (`focus-visible:ring-[3px]` em
  `FormaPagamentoBadge.tsx:33` e `GrupoBoletoLinha.tsx:77`), não alterado aqui.
- QA manual local (cópia PRD 29/10, stub Conexos): RHENUS 5541/5566 → `GRUPO_SUGERIDO`, "Ver grupo sugerido" na
  faixa "vencem hoje", gaveta com aviso, "Ver grupo" abre a aba no card; 1:1 de 129818 recusado com 409.

## Anotações do QA local de 2026-10-29 (UI da gaveta e da aba Boletos DDA)
- [ ] **ingestao-pes-cod** — `TituloAPagarRepository.ts:143` sobrescreve `pes_cod` incondicionalmente na ingestão
  (`pes_cod = EXCLUDED.pes_cod`). Se o Conexos deixar de mandar `pesCod`, TODOS os grupos somem em silêncio (o motor
  de grupos ignora título sem credor). Visto localmente com o stub em 2026-10-29: a rodada das 15:11 deixou `pes_cod`
  nulo nos 2.092 títulos ativos e as sugestões de grupo caíram para zero. Sugestão: `COALESCE(EXCLUDED.pes_cod,
  titulo_a_pagar.pes_cod)` como já é feito com `forma_pagamento_conexos`, e um aviso de log quando a rodada traz
  títulos sem credor.
- [ ] **design-system-datas** — DesignSystemReviewer (PT17): duas chamadas `toLocale*` sem fuso em
  `BoletosDdaTab.tsx` (`toLocaleString('pt-BR')` do "DDA de …" e `toLocaleDateString('pt-BR')` da data de importação;
  código pré-existente). Mais a nota de movimento reduzido: o `rotate-180` do chevron do grupo usa
  `transition-transform` sem `motion-reduce`.
- [ ] **gaveta-grupo-latencia** — o bloco do grupo na gaveta leva alguns segundos com o cache frio (lê as sugestões e
  os grupos da filial ao abrir). Avaliar levar o resumo do grupo no próprio desfecho ou pré-carregar por filial.
- [ ] **botao-confirmar-aria-busy** — DesignSystemReviewer (feedback.md): durante a chamada, o "Confirmar grupo" usa
  `disabled` em vez de `aria-busy` (o leitor de tela não anuncia o estado). Mantido como na antiga aba (o teste de
  clique duplo depende dele); revisar junto com os demais botões de decisão do SISPAG.

