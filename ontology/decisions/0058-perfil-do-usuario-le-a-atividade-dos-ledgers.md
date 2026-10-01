---
adr_number: 0058
title: Perfil do usuário lê a própria atividade dos ledgers, com as regras das métricas do ciclo
date: 2026-10-01
status: accepted
type: addition
related_entities: [Usuario, AtividadeUsuario]
related_actions: [lerPerfil, lerAtividade, listarHistorico]
related_integrations: []
continues: [0042, 0051, 0052, 0053, 0055, 0056, 0057]
evidence:
  - ontology/_inbox/perfil-usuario-interview.md
  - ontology/_inbox/perfil-usuario-ontology-diff.md
  - src/backend/migrations/0070_metricas_ciclo_sispag.sql
  - src/backend/routes/me.ts
  - src/backend/http/acesso.ts
---

# ADR-0058 — Perfil do usuário lê a própria atividade dos ledgers

> Número checado contra a `main` e todas as refs remotas em 2026-10-01 (maior existente: 0057). Se a
> `main` tomar a 0058 antes do merge, renumerar no rebase.

## Contexto

A feature `perfil-usuario` cria a página `/perfil`: identidade, permissões efetivas com origem, KPIs
pessoais por frente e o histórico unificado das próprias ações. O usuário da plataforma não tinha
arquivo na ontologia (só ADRs 0051/0053/0057), e a atividade por usuário não existia como conceito.

## Decisão

1. **`Usuario` entra na ontologia como entidade de plataforma** (`entities/usuario.md`),
   consolidando as ADRs 0051/0053/0057 sem decidir nada novo sobre acesso.
2. **`AtividadeUsuario` é um read model** (`entities/atividade-usuario.md`) sobre 9 ledgers, sem
   tabela própria, no padrão da ADR-0042. Só índices aditivos por (ator, tempo).
3. **Alvo só da identidade autenticada.** O serviço recebe o alvo como parâmetro interno (pronto para
   a v2, admin vê outro usuário); a v1 não tem rota com id e recusa parâmetros desconhecidos.
4. **Os KPIs reusam as regras de `metricas.metricas_ciclo()`**: grade sexta 18:00 → sexta 18:00 em
   São Paulo, datação por `COALESCE(encerrado_em, criado_em)` (ADR-0052) e, em Permutas, **só
   execuções com borderô finalizado** contam. Número principal = `settled` finalizada (o
   "concluídas" do `/metricas`); R$ = `settled` + `parcial` finalizadas (as mesmas linhas da métrica).
   O perfil é uma fatia do `/metricas`, não uma métrica paralela. Secundários: "N parciais", "N
   aguardando borderô finalizado" (fora do número e do R$) e "N com erro".
5. **SISPAG:** o lote é atribuído a quem o **finalizou**; o R$ é o **remessado** pelo usuário
   (`SUM(lote_pagamento_item.valor)` dos lotes cuja 1ª remessa `settled` ele executou); "pago
   confirmado" só com `situacao = 'PAGO'` (ADR-0055).
6. **Conciliação datada por `atualizado_em`**, aproximação documentada. Carimbar `encerrado_em` é
   follow-up.
7. **Histórico mostra todas as ações do próprio usuário**, inclusive de frentes cuja permissão `ver`
   ele perdeu; só o link para a frente é ocultado. Os tiles de KPI são gated por `<frente>:ver`.

## Rejeições (não entram na ontologia)

| Candidato | Decisão | Motivo |
|---|---|---|
| Menu de avatar, dropdown, cards empilhados, seção de senha "em breve" | REJECT-NOT-DOMAIN | UI; vive no design system e no código |
| Deep links com foco no item (`?lote=`, `?adto=`) | REJECT-NOT-DOMAIN | navegação; follow-up de UI |
| Rótulo "Adiantamentos" vs "Recebimentos" no grupo da Frente IV | REJECT-NOT-DOMAIN | rótulo de tela; segue o nav. A ontologia continua chamando a frente de Recebimentos |
| `solicitacao_numerario` (com299 de Permutas) no histórico | REJECT-PREMATURE | a permuta já aparece pela execução; entra se pedido |
| Política de troca de senha própria | REJECT-PREMATURE | backend `feat/auth-senha-propria` não existe |
| Índices por (ator, tempo) | fora da ontologia | detalhe físico do banco |

## Consequências

- Nenhum writer muda; o blast radius é leitura. O pior caso é um KPI errado ou o vazamento da trilha
  de outro usuário, coberto por teste dedicado de isolamento.
- Como em Permutas a regra é a da métrica, a soma pessoal de semanas fechadas tem de ser igual à
  fatia do usuário no `/metricas`. Divergência é bug (gate de equivalência read-only).
- Um borderô estornado tira a execução do KPI retroativamente, como já acontece no `/metricas`.
- Diferença conhecida em relação ao `/metricas`: lá o contador "concluídas" de Permutas conta só
  `settled` (o `parcial` entra no R$, não no contador). Aqui o número principal conta `settled` +
  `parcial`, o mesmo conjunto que forma o R$.
