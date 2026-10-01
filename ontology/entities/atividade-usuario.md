---
name: AtividadeUsuario
type: entity
ontology_version: "0.32.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/routes/me.ts
  - src/backend/domain/service/perfil/PerfilService.ts
  - src/backend/domain/service/perfil/PeriodoPerfil.ts
  - src/backend/domain/service/perfil/HistoricoCursor.ts
  - src/backend/domain/repository/perfil/AtividadeUsuarioRepository.ts
  - src/backend/domain/repository/perfil/PerfilRepository.ts
  - src/backend/domain/interface/perfil/AtividadeUsuarioInterface.ts
  - src/backend/migrations/0072_idx_atividade_usuario.sql         # índices (ator, tempo)
  - src/backend/jobs/validate-perfil-usuario-v1.ts                # equivalência com metricas_ciclo
  - src/frontend/app/perfil/page.tsx
  - src/frontend/lib/api/perfil.ts
  - src/backend/migrations/0070_metricas_ciclo_sispag.sql         # grade de semanas e regras compartilhadas
properties:
  - em
  - frente
  - acao
  - alvoTipo
  - alvoId
  - valor
  - status
  - fonte
  - fonteId
relationships:
  - "AtividadeUsuario é uma projeção (read model) sobre 9 ledgers; não tem tabela própria"
  - "Cada linha tem exatamente 1 Usuario como ator (ou alvo, para EventoAcesso)"
  - "Os KPIs por frente compartilham a grade semanal e as regras de sucesso de metricas.metricas_ciclo()"
last_review: 2026-10-01
universality_evidence:
  - "ADR-0042 (read model sobre tabelas existentes, sem migrar writers; precedente JobRun)"
  - "ADR-0045/0052/0056 (métricas do ciclo: ledger, datação pelo encerramento, SISPAG por título aceito)"
  - "ADR-0055 (situacao PAGO só a partir da baixa no ERP, fin064)"
  - "ADR-0058 (esta feature)"
---

# AtividadeUsuario

> **Read model, NÃO tabela** (padrão ADR-0042 / `JobRun`). Projeção normalizada, só leitura, das
> ações registradas nos ledgers que já existem. Nenhuma migration cria tabela; só índices aditivos
> por (ator, tempo). Nenhum writer é tocado. Decisões: **ADR-0058**.

Serve duas leituras do perfil pessoal: o **histórico** (linhas) e os **KPIs por frente** (agregados).

## Forma da linha

`{ em, frente, acao, alvoTipo, alvoId, valor?, status, fonte, fonteId }`

- `frente ∈ permutas | sispag | recebimentos | plataforma`
- `status ∈ sucesso | erro | em_andamento | cancelado | info` (normalizado)
- `valor` em BRL quando a fonte tem grandeza monetária; ausente caso contrário
- Ordem estável `(em DESC, fonte, fonteId DESC)`: ids de tabelas diferentes colidem, por isso o
  desempate inclui `fonte`.

## Fontes (v1)

Todas filtram `dry_run = false` onde a coluna existe.

| # | Ledger | Ator | `em` | Status → normalizado | Valor | Frente |
|---|---|---|---|---|---|---|
| 1 | `permuta_alocacao_execucao` | `executado_por` | `COALESCE(encerrado_em, criado_em)` | settled, parcial → sucesso; error → erro; pending, reconciling → em_andamento | `valor_baixado` | permutas |
| 2 | `permuta_excecao_manual` (criar / remover) | `criado_por` / `removido_por` | `criado_em` / `removido_em` | info | — | permutas |
| 3 | `lote_pagamento` (criar / finalizar) | `criado_por` / `finalizado_por` | `criado_em` / `finalizado_em` | CANCELADO → cancelado; finalizar → sucesso; criar → info | finalizar: `SUM(lote_pagamento_item.valor)` | sispag |
| 4 | `lote_pagamento_item_destino_audit` | `alterado_por` | `alterado_em` | info | — | sispag |
| 5 | `remessa_execucao` | `executado_por` | `COALESCE(encerrado_em, criado_em)` | settled → sucesso; error → erro; pending, reconciling → em_andamento | `SUM(lote_pagamento_item.valor)` do lote | sispag |
| 6 | `conciliacao_execucao` | `executado_por` | **`atualizado_em`** (aproximação, ver A3) | settled → sucesso; error → erro; pending, reconciling → em_andamento | — | sispag |
| 7 | `solicitacao_numerario_execucao` | `executado_por` | `COALESCE(encerrado_em, criado_em)` | settled → sucesso; error → erro; pending, reconciling → em_andamento | `valor` | recebimentos |
| 8 | `alerta` (reconhecimento) | `reconhecido_por` | `reconhecido_em` | info | — | plataforma |
| 9 | `app_user_access_event` | `ator` **ou** `alvo_user_id` | `em` | info | — | plataforma |

**Fora da v1, de propósito:** `solicitacao_numerario` (com299 da trilha de Permutas; a permuta já
aparece pela fonte 1) e `recebimento_execucao` (spine vazia em produção). Entram se pedidos.

## KPIs por frente

Período = intervalo semiaberto `[inicio, fim)` em horário de São Paulo. "Esta semana" usa **a grade
de `metricas.metricas_ciclo()`**: janela sexta 18:00 → sexta 18:00 (âncora `metricas.serie_inicio()`),
ou seja, `[última sexta 18:00 ≤ agora, agora)`. "Hoje" e "este mês" começam à 00:00 SP.

| Frente | Número principal | R$ | Secundário |
|---|---|---|---|
| Permutas | execuções `settled` **com borderô finalizado** (`bor_vld_finalizado = 1`, `bor_cod_estornado IS NULL`), **idêntico ao "concluídas" de `metricas_ciclo`** | `SUM(valor_baixado)` das execuções `settled` + `parcial` com borderô finalizado, **as mesmas linhas de `metricas_ciclo`** | `N parciais` (`parcial` com borderô finalizado; entram no R$, não no número principal); `N aguardando borderô finalizado` (`settled`/`parcial` sem borderô finalizado, fora do número e do R$); `N com erro` |
| SISPAG | lotes finalizados pelo usuário (`finalizado_por`, `finalizado_em` no período, `status <> 'CANCELADO'`); remessas geradas (1ª `settled` por lote); retornos conciliados | **R$ remessado**: `SUM(lote_pagamento_item.valor)` dos lotes cuja **1ª** remessa `settled` foi executada pelo usuário | R$ agendado (`situacao ∈ AGENDADO, PAGO`); R$ pago confirmado (`situacao = PAGO`); `N com erro` |
| Recebimentos | `solicitacao_numerario_execucao` `settled` | `SUM(valor)` | `N com erro` |

## Regras de atribuição e datação

- **A1 Ator = username da plataforma.** Nunca o robô. Quem assinou no ERP (`conexos_username`) é
  dado de detalhe, não de atribuição. Usuário sem vínculo Conexos vê as próprias ações normalmente.
- **A2 Datação pelo encerramento** (ADR-0052): `COALESCE(encerrado_em, criado_em)`. Eventos pontuais
  (fontes 2, 3, 4, 8, 9) usam o próprio carimbo. Nunca `atualizado_em` onde há alternativa, porque
  ele anda com o re-clique.
- **A3 Exceção conhecida: conciliação.** `conciliacao_execucao` não tem `encerrado_em`; usa
  `atualizado_em`, que também anda no `processou = TRUE`. Aproximação aceita na v1. Carimbar
  `encerrado_em` (padrão 0065/0070) é follow-up, porque toca um write path.
- **A4 Lote SISPAG pertence a quem o finalizou.** Voltar o lote a rascunho apaga
  `finalizado_por/finalizado_em`: só a finalização vigente é atribuível. Cancelamento não tem autor
  nem data.
- **A5 Uma remessa por lote no R$.** Só a 1ª `settled` não-dry do lote conta, como na 0070.
- **A6 Retroatividade herdada da métrica.** Um borderô estornado depois tira a execução do KPI de
  Permutas, igual ao `/metricas`. O histórico continua mostrando a linha com o status da execução.

## Invariantes

- **I1 Escopo do próprio usuário.** O alvo da leitura vem **só** da identidade autenticada
  (`req.user.sub` + `req.acesso.userId`). Nenhum input do cliente escolhe o alvo; parâmetros
  desconhecidos são rejeitados (400), não ignorados. O serviço recebe o alvo como parâmetro interno
  para a v2 (admin vê perfil de outro usuário) sem refatoração; a v1 não expõe rota com id.
- **I2 Sem autoescalada.** O read model é só leitura. Nenhuma escrita de papel, exceção, vínculo ou
  e-mail passa por ele (U2 em [`usuario.md`](usuario.md)).
- **I3 Só sucesso terminal no número principal.** `dry_run` nunca conta; `pending`/`reconciling`
  não contam; `error` é secundário.
- **I4 Nunca "pago" sem confirmação do ERP.** "remessado" = remessa `settled` gerada por nós;
  "agendado" = o .RET aceitou; "pago confirmado" = `situacao = 'PAGO'`, gravada pela sincronização a
  partir da baixa do título lida no **fin064** (ADR-0055). A remessa é "gerada", não "enviada".
- **I5 503 nunca desloga.** Falha ao verificar acesso ou permissões aparece como "não foi possível
  verificar", nunca como "sem acesso" nem como sessão encerrada (U3).
- **I6 Credenciais nunca saem.** `password_hash` e `conexos_password_enc` não são selecionados.
- **I7 Números batem com `/metricas`.** Mesma grade semanal, mesma datação e, em Permutas, o mesmo
  filtro de borderô finalizado: o número principal é o "concluídas" (`settled` finalizada) e o R$ usa
  as mesmas linhas (`settled` + `parcial` finalizadas). Divergência entre a soma pessoal e a fatia do usuário em
  `/metricas` é bug.

## Ações (só leitura)

| Ação | Contrato | Pré-condição | Pós-condição |
|---|---|---|---|
| `lerPerfil` | `GET /me` | autenticado | nenhuma mudança de estado |
| `lerAtividade` | `GET /me/atividade?inicio&fim` | autenticado | idem |
| `listarHistorico` | `GET /me/historico?cursor&frente&tipo&status&inicio&fim` (keyset, 25 por página, default 30 dias) | autenticado | idem |

Nenhuma chamada a sistema externo (Conexos, Nexxera, SharePoint).
