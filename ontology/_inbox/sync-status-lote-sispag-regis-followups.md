# Regis-Review — follow-ups de `sync-status-lote-sispag` (ADR-0055)

Executado em 2026-09-29 (run 2026-09-29-2020, `--quick`, 8 QAs em sonnet + `qa-consolidator`), escopo
restrito aos diretórios tocados. Seções e KANBAN em
`docs/regis-review/2026-09-29-2020-sync-status-lote-sispag/`. Scores: security 7,5 · fault-tolerance 8 ·
availability 7 · modifiability 7 · testability 8 · performance 7 · integrability 7 · deployability 6,5
(overall ponderado 7,3).

**Nenhum P0.** Por isso nada re-entrou no loop. Os itens abaixo NÃO foram implementados; detalhe
(Problema / Melhoria / Resultado esperado) em `KANBAN.md` pelo id do card. Duplicatas fundidas:
availability-1 = fault-tolerance-1; availability-4 = deployability-2; integrability-2 = testability-2.

Remediado no ciclo, fora do Regis-Review: P0 do ObservabilityAdvisor (log de erro por lote quando
nenhum título pôde ser lido) e 3 `text-[11px]` novos do DesignSystemReviewer.

## Follow-ups (NÃO implementados)

- [P1] Tornar o staleness da sincronização sensível à janela útil (`availability-2`)
- [P1] Gravar trilha de auditoria da transição de lote e da situação dos itens (`fault-tolerance-3`)
- [P1] Iniciar cobertura dos jobs de cron e quebrar RemessaService.test.ts [pré-existente] (`testability-5`)
- [P2] Isolar falha por lote na passada de sincronização (`availability-1`)
- [P2] Desacoplar o minuto do cron das demais rotinas que usam a sessão Conexos (`availability-4`)
- [P2] Atualizar o orçamento de sessões do DEPLOY.md e ler o teto do Supavisor (`deployability-1`)
- [P2] Documentar deploy e rollback da 0069 no DEPLOY.md (`deployability-3`)
- [P2] Devolver `legivel:false` quando linhas de baixa falham no schema (`integrability-1`)
- [P2] Gravar fixtures reais de fin064, fin052 detalhe e com308 e testar o parsing (`integrability-2`)
- [P2] Carregar lotes da sincronização em query única (`performance-1`)
- [P2] Reduzir leituras fin064 de itens terminais na janela de estorno (`performance-2`)
- [P2] Impor deadline de passada e gravar resumo parcial (`performance-3`)
- [P2] Propagar o desfecho do fechamento por lote na conciliação L9/L10 (`fault-tolerance-2`)
- [P2] Gravar o ator no sincronizar manual (`security-1`)
- [P2] Adicionar orçamento de tempo e limite de falhas consecutivas na passada (`availability-3`)
- [P2] Extrair fachada de leitura de situação do título (anti-corruption layer) (`integrability-3`)
- [P2] Dividir SincronizacaoLoteService em carga, casamento e aplicação (`modifiability-1`)
- [P2] Quebrar LotePagamentoRepository por responsabilidade (`modifiability-2`)
- [P2] Alarme de falha de autenticação e conclusão da auth em 3 passos (`security-4`)
- [P2] Cobrir SQL do LotePagamentoRepository em Postgres real (`testability-1`)
- [P2] Tirar acesso direto a client/repositório de routes/sispag.ts (`modifiability-3`)
- [P3] Adicionar kill-switch ao sync e alinhar Node entre CI e crons (`deployability-4`)
- [P3] Externalizar a janela de estorno e reduzir complexidade das duas funções (`modifiability-4`)
- [P3] Instrumentar duração e chamadas Conexos; deadline na rota manual (`performance-4`)
- [P3] Verificar linhas afetadas nos UPDATEs de item (`fault-tolerance-4`)
- [P3] Endurecer o workflow de sincronização (`security-2`)
- [P3] Remover a rota 410 após a janela de cache (`security-3`)
- [P3] Asserir logs nos caminhos degradados e expor o relógio ao job (`testability-3`)
- [P3] Adicionar testes de propriedade à DecisaoStatusLote (`testability-4`)

## Notas

- `modifiability-4` cita `ConexosTitulosClient.ts:312`: é a função pré-existente `listTitulosAPagar`.
- Minuto alternativo do cron (:50 vs :05): decidir depois de listar todos os `cron:` dos workflows.
- `performance-2` (cadência de releitura de BAIXADO) depende de decisão de negócio sobre a latência de detecção de estorno.
