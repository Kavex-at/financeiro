# Interview — metricas-ciclo

> Slug: `metricas-ciclo` · Branch: `feat/metricas-ciclo` · Base: `main` (@ `14ca71a`)
> Modo: `new` · Data: 2026-09-14 · `entity_changed = false`
> Fonte das respostas: o brief do `/feature-new` (denso o bastante para dispensar as perguntas de
> abertura) + sondagem **read-only** do Postgres de produção feita nesta sessão. Onde o dado vivo
> contradisse o brief, está marcado **⚠ divergência** e virou decisão em `metricas-ciclo-gap.md`.

## Intenção (1 frase)

O report semanal da Columbia mostra ritmo (commits, PRs, versões). A Seção 3 precisa mostrar
**efeito**: quanto trabalho o sistema fez pela operação na semana, lido de uma view de forma fixa
(`vw_metricas_ciclo`) que o `kavex-report-ciclo/scripts/metrics.py` consome sem saber o significado.

## Eixo 1 — Entidade

- **Nenhuma entidade nova.** A view é um read-model agregado sobre ledgers que já existem.
  `entity_changed = false`.
- Ledgers de origem, confirmados nas migrations **e** no banco vivo:

| Frente | Tabela | Colunas usadas | Linhas vivas (2026-09-14) |
|---|---|---|---|
| I — Permutas | `permuta_alocacao_execucao` (0015, 0051, 0056) | `status`, `dry_run`, `valor_baixado`, `criado_em`, `bor_cod`, `fil_cod` | 190 (177 settled, 13 error) |
| I — Permutas | `permuta_bordero` (cache do ERP) | `bor_vld_finalizado` | — |
| IV — Recebimentos | `solicitacao_numerario_execucao` (0041, 0042) | `status`, `dry_run`, `valor`, `criado_em` | 23 |
| IV — Recebimentos | `recebimento` / `recebimento_execucao` / `rateio_recebimento` | — | **0 / 0 / 0** |

- **⚠ divergência D1.** O brief aponta `recebimento`, `recebimento_execucao` e `rateio_recebimento`
  como fonte da Frente IV. As três estão **vazias em produção** (já estavam em 2026-08-20, ver
  `docs/impacto/dados/h0-recebimentos-kpis.json`, consulta `spine_recebimento_populada`). O
  caminho que de fato aloca crédito de cliente e emite NDe é a trilha da SN
  (`solicitacao_numerario_execucao`, "o caminho de produção" nas próprias sondagens). Uma view sobre
  a spine vazia reportaria "0 créditos alocados" numa semana em que R$ 789 mil foram alocados — número
  falso com cara de medido.

## Eixo 2 — Ação

- Única ação: **ler**. A view não escreve, não chama o Conexos, não dispara nada (regra 1 do brief).
- Consumidor: `metrics.py` com `SELECT ... FROM vw_metricas_ciclo WHERE janela_inicio >= %(inicio)s
  AND janela_fim <= %(fim)s`, conectado por `DSN_FINANCEIRO`.

### Métricas (duas por frente)

| `metrica` (chave estável) | Unidade | Definição |
|---|---|---|
| `permutas_baixas_concluidas_pct` | `%` | pares adto↔invoice com `status='settled'` e borderô não cancelado ÷ pares tentados (`dry_run=false`) com `criado_em` na janela |
| `permutas_valor_baixado` | `R$` | `SUM(valor_baixado)` das linhas `settled`/`parcial` com borderô não cancelado |
| `recebimentos_alocacoes_concluidas_pct` | `%` | SN com `status='settled'` ÷ SN tentadas (`dry_run=false`) com `criado_em` na janela |
| `recebimentos_valor_alocado` | `R$` | `SUM(valor)` das SN `settled` |

- `valor_baixado` é **BRL gravado no momento da baixa** (`ReconciliacaoPermutaService` →
  `totalBaixadoBrl`). `solicitacao_numerario_execucao.valor` é o valor alocado do crédito bancário, BRL.
  Regra 3 do brief atendida sem reconsultar o ERP.
- **⚠ divergência D2 — "sem toque humano".** O brief pede "% de créditos alocados sem toque humano".
  Nenhuma tabela registra esse fato: toda SN é disparada por um analista (`executado_por` é sempre
  pessoa ou `admin`), `regra_recebimento` tem 0 regras e `recebimento_regra_aplicada` 0 linhas. O
  único flag parecido, `revisao_humana`, significa outra coisa (homologação voltou com validação
  pendente no com194). Publicar esse % hoje seria inventar a métrica, que é exatamente o que a regra
  4 proíbe para o baseline. Substituído, **provisoriamente**, pela taxa de conclusão.
- **⚠ divergência D3 — borderô cancelado.** 20 baixas `settled` (R$ 3,03 mi) estão em borderôs com
  `bor_vld_finalizado = 2`. Cancelar estorna a baixa no ERP. Contá-las como concluídas inflaria o
  número em ~11% das baixas. Decisão provisória: não contam no numerador nem no R$; continuam no
  denominador (foi uma tentativa que não ficou de pé). *Ampliado na implementação:* borderô
  ESTORNADO (`bor_cod_estornado IS NOT NULL`) recebe o mesmo tratamento, porque a tela o trata como
  permuta liberada para relançar (`BorderoGestaoService.situacaoDoItem`).
- **Absoluto junto do percentual.** O contrato exige "sempre exiba o absoluto", mas limita a duas
  métricas por frente. O `rotulo` do `%` carrega o absoluto: "… — 12 de 13 tentativas". A chave
  (`metrica`) continua estável. O rótulo muda de semana para semana, e é para isso que ele existe.

## Eixo 3 — Invariantes

1. **I-M1 Somente leitura.** Nenhum `INSERT/UPDATE/DELETE`, nenhuma função com efeito. O leitor
   conecta com `default_transaction_read_only = on`.
2. **I-M2 Sem histórico reconstruído.** A série começa em `2026-09-11 20:00` (a janela do ciclo 6,
   em que a view entra no ar). Janelas anteriores **não são emitidas**, embora o ledger as tenha:
   o ledger de permutas apaga linhas quando um borderô é excluído, e as definições acima não
   existiam antes deste contrato.
3. **I-M3 Só janela fechada.** Uma janela só aparece quando `janela_fim <= agora`. Semana em curso
   não é emitida: um número parcial rotulado como "da semana" é incompleto e parece fechado.
4. **I-M4 Janela sexta 20:00 → sexta 20:00, horário de São Paulo, em `timestamp` sem fuso.** A
   sessão do Supabase roda em UTC. Se a coluna fosse `timestamptz`, o `'2026-09-11T20:00:00'` que o
   `metrics.py` envia seria lido como 17:00 em São Paulo e o filtro erraria a semana.
5. **I-M5 `baseline` só com fonte.** `NULL` em todas as linhas: não há medição do processo manual.
6. **I-M6 Chave nunca renomeada.** Mudou a definição, cria-se chave nova e anota-se a quebra.
7. **I-M7 Tentativa atribuída à semana em que começou** (`criado_em`, imutável), com o desfecho
   do estado atual do ledger. `atualizado_em` não serve: reabertura de erro e operações de borderô o
   movem.
8. **I-M8 Sem PII e sem acesso às tabelas.** O leitor só tem `SELECT` na view (definer). As tabelas
   de origem guardam `erp_response`, `request_payload` e e-mails; nada disso chega ao report.

## Eixo 4 — Integração

- **Conexos:** nenhuma chamada.
- **Postgres (Supabase):** migration `0058_vw_metricas_ciclo.sql`, aplicada no boot pelo `BootMigrator`.
  - schema dedicado `metricas`, fora do PostgREST (não exposto a `anon`/`authenticated`);
  - role `metricas_ciclo_leitor` (`NOLOGIN` na migration, `search_path = metricas`, read-only,
    `statement_timeout = 30s`), com `USAGE` no schema e `SELECT` só na view.
- **Passo humano (senha não entra em migration):** `ALTER ROLE metricas_ciclo_leitor LOGIN PASSWORD '…'`
  e `DSN_FINANCEIRO` apontando para ele. Precisa ser o próprio role, e não um membro dele: os
  `ALTER ROLE … SET` não são herdados por membros.
- **⚠ divergência D4 — `metrics.py` com data sem hora.** O filtro é `janela_fim <= fim`. Com
  `--fim 2026-09-18`, o Postgres lê `2026-09-18 00:00`, e a janela que fecha às 20:00 fica de fora:
  **zero linhas**. O critério "`metrics.py --inicio 2026-09-11 --fim 2026-09-18` devolve ≥ 1 linha"
  só passa com `--fim 2026-09-18T20:00:00`, que é a forma do exemplo na docstring do script. O
  script também exige `--config`, e `config/columbia.json` ainda não existe na skill.

## Fora de escopo

- SISPAG (sem remessa aceita pelo banco, sem operação real para medir).
- Editar o `metrics.py`/`render.py` (vivem na skill, fora deste repo). Os achados vão para o gap.
- Tabela de eventos append-only. É o conserto de fundo para I-M2/I-M7 e fica como follow-up.
