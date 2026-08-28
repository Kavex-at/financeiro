---
adr_number: 0041
title: O fallback para o robô continua silencioso para o usuário, mas deixa de ser silencioso para a operação — e toda execução passa a registrar a identidade Conexos que a realizou
date: 2026-08-28
status: accepted
type: change
related_entities: [Permuta, Recebimento, SolicitacaoNumerario, LotePagamento]
related_actions: [reconciliar-permuta, executar-recebimento, gerar-remessa, conciliar-retorno]
related_integrations: [conexos]
supersedes_decisions: []
amends_decisions: [0013]
---

# ADR 0041: o robô pode assumir, mas não pode assumir sem deixar rastro

**Cliente:** Columbia Trading · **Entrega:** Kavex · **Branch:** `fix/conexos-fallback-audit`.
**Fonte:** `/investigate` + `/feature-tweak` com o Yuri (2026-08-26). **`entity_changed = true`** — os
ledgers de execução das cinco frentes ganham duas colunas e um novo invariante de auditoria.

## Contexto

A "Fatia B" (2026-08, commit `ab59afc`) deu a cada usuário da plataforma a opção de um vínculo Conexos:
tendo um, as escritas no ERP saem no nome dele; não tendo, saem no nome do robô. A engenharia está certa
e funciona — há sessão por usuário, chave própria no `conexos_sessions`, `usnCod` próprio no
`cnx-usncod`.

O que faltou foi o que acontece quando o vínculo existe mas **não funciona**.

Em 2026-08-25 uma investigação mostrou um usuário com vínculo cadastrado (`MARILYN_MUTAFCI`) cujo login
no ERP nunca completava. Efeito: 35 execuções — 13 delas no mesmo dia, todas `settled`, `dry_run=false`,
baixas reais no `fin010` — saíram sob o robô. O sistema se comportou **exatamente como projetado**: o
`resolveForUser` tem três `catch` que devolvem o robô, e o comentário no topo do arquivo diz, com todas as
letras, *"em runtime o fallback é silencioso"*.

O diagnóstico só foi possível por uma evidência indireta: a **ausência** de uma linha
`columbia:user:MARILYN_MUTAFCI` em `conexos_sessions`, contrastada com a presença de
`columbia:user:SIMONE_PEREIRA` (version 32, renovada no mesmo dia). Nada nos logs. Nada no ledger.

## Decisão

Separar duas coisas que estavam coladas sob a palavra "silencioso":

1. **Silencioso para o usuário** — continua. Ninguém é interrompido no meio de uma baixa porque a
   credencial dele não logou. O banner de login (`/me/conexos-status` → `falha`) já é o canal certo, e
   permanece o único aviso por-ação. **Não** adicionamos aviso por-execução.

2. **Silencioso para a operação** — acaba. Um usuário **com** vínculo que cai no robô é um evento
   operacional: passa a emitir `warn` estruturado (`platformUsername`, `conexosUsername`, motivo). Sem
   vínculo e fora de request seguem mudos — são o caminho normal, logar viraria ruído.

E fechar o buraco de auditoria que o incidente expôs: todo ledger write-ahead grava, junto do
`executado_por` (usuário da plataforma), o `conexos_username` + `conexos_usn_cod` da sessão que
**de fato** executou. Seis ledgers, não só o da permuta onde o caso apareceu — o resolver é o mesmo para
todas as frentes, e o ponto cego era idêntico em todas.

## Alternativas consideradas

**Bloquear a execução quando a identidade não é a do usuário.** Rejeitada. Transformaria uma degradação
recuperável (a baixa sai, com o nome errado) numa indisponibilidade (a baixa não sai). O robô existe
justamente porque a operação não pode parar; e as quatro causas de fallback incluem duas perfeitamente
normais (job, usuário sem vínculo).

**Avisar o usuário a cada execução feita pelo robô.** Rejeitada. Para quem não tem vínculo — a maioria —
seria um aviso em toda ação, sobre um estado que é o esperado. O sinal certo é no login, e ele já existe.

**Registrar só na permuta.** Rejeitada na entrevista. O incidente apareceu ali por acaso; o mesmo resolver
serve SISPAG, recebimentos e numerário, com o mesmo ponto cego.

**Backfill das linhas históricas.** Impossível de fazer com honestidade — a identidade usada no passado não
está gravada em lugar nenhum. Nulo fica significando "não capturada", nunca "robô".

## Consequências

- Um vínculo quebrado vira um `warn` na primeira ação, não uma arqueologia de `conexos_sessions`.
- "Esta baixa saiu no nome de quem?" passa a ser uma consulta ao ledger.
- Duas colunas nulas nas linhas anteriores à migration `0051` — dívida assumida e documentada.
- O comportamento visível ao usuário não muda em nada.

## Correção de escopo dentro do ciclo

A primeira implementação cobriu **cinco** ledgers, montando a lista pelo sufixo `_execucao`. O
Regis-Review de 2026-08-28 achou a sexta por dois caminhos independentes (`modifiability-2`,
`fault-tolerance-1`): `solicitacao_numerario` (0032) é write-ahead igual, guarda escrita
irreversível no ERP e é alcançável por rota — só não carrega o sufixo. Corrigido no mesmo ciclo,
antes do PR. **O critério passa a ser "guarda escrita irreversível no ERP", não o nome da tabela.**

## Não decidido aqui

A causa-raiz do incidente (por que aquela credencial não loga) é operacional e fica com o time — senha
incorreta, conta bloqueada e limite de sessões produzem o mesmo sintoma. Esta ADR garante que a
**próxima** ocorrência apareça em minutos, não em meses.

Também fica de fora, deliberadamente, declarar `CONEXOS_CRED_ENC_KEY` no `render.yaml` /
`.env.example` — sem a chave, todo vínculo degrada para o robô em qualquer ambiente que não seja produção.
Levantado na investigação, adiado pelo Yuri. Follow-up em
`ontology/_inbox/conexos-fallback-audit-regis-followups.md`.
