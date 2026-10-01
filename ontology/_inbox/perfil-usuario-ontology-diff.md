## Ontology Diff — perfil-usuario (2026-10-01)

> **Aplicado na branch `feat/perfil-usuario`, sem commit, sem aprovação prévia.** O Yuri estava
> ausente; a revisão do PR é o gate de aprovação desta diff. Para rejeitar, reverta os arquivos
> listados abaixo. Nada fora da branch foi tocado.

Entrada: `ontology/_inbox/perfil-usuario-interview.md` (`entity_changed: true`) + decisões do
orquestrador sobre P1-1..P1-4.

### Candidate analysis

| Candidato | Filtros | Decisão |
|---|---|---|
| Entidade `Usuario` (app_user + papel + exceção + trilha + vínculo Conexos) | A: S (ator de todas as frentes; ADR-0051/0053/0057), B: onto (estrutura), C: S, D: novo arquivo, conceito já decidido em ADRs, E: entidade | ACCEPT (consolidação, sem decisão nova) |
| Read model `AtividadeUsuario` (histórico + KPIs) | A: S (projeção dos ledgers de todas as frentes), B: onto, C: S, D: novo (padrão JobRun), E: leitura, não estado | ACCEPT (planned) |
| Ações `lerPerfil` / `lerAtividade` / `listarHistorico` | só leitura, sem pré/pós-condição de estado | documentadas dentro do read model, **sem arquivos de action e sem contador** |
| Regras R1–R8 da entrevista | todas ligadas ao read model | invariantes I1–I7 e regras A1–A6 dentro de `atividade-usuario.md`; **sem arquivos em `business-rules/`** (escopo mínimo) |
| Menu de avatar, dropdown, cards, seção de senha "em breve" | UI | REJECT-NOT-DOMAIN (ADR-0058) |
| Deep links com foco (`?lote=`, `?adto=`) | navegação | REJECT-NOT-DOMAIN, follow-up |
| Rótulo "Adiantamentos" vs "Recebimentos" (Frente IV) | rótulo de tela | REJECT-NOT-DOMAIN; a tela segue o nav ("Adiantamentos"); o spec dizia "Recebimentos"; a ontologia mantém "Recebimentos" |
| `solicitacao_numerario` (com299 de Permutas) no histórico | P1-3 | REJECT-PREMATURE (fora da v1) |
| Política de senha própria | backend inexistente | REJECT-PREMATURE |
| Índices (ator, tempo) | físico | fora da ontologia |
| `encerrado_em` em `conciliacao_execucao` | P1-1 | não entra agora; aproximação por `atualizado_em` documentada (regra A3), carimbo é follow-up |

### Arquivos alterados

1. `ontology/entities/usuario.md` — **NOVO**
2. `ontology/entities/atividade-usuario.md` — **NOVO**
3. `ontology/decisions/0058-perfil-do-usuario-le-a-atividade-dos-ledgers.md` — **NOVO** (maior ADR na `main` e em todas as refs remotas: 0057)
4. `ontology/_index.json` — `_meta` + 2 entradas novas
5. `ontology/_coverage.json` — `_meta` + `summary` + 2 entradas em `by_entity`
6. `ontology/CHANGELOG.md` — entrada v0.32.0

### Antes / depois por arquivo

**`entities/usuario.md`**
- ANTES: não existia. O usuário estava só nas ADRs 0051/0053/0057.
- DEPOIS: entidade de plataforma `implemented`. Identidade = `username` imutável; papel (1 por
  usuário) + exceções (revogar vence) + implicação executar ⇒ ver; origem da permissão em 4 valores
  (papel / concedida / revogada / implicada); trilha `app_user_access_event`; vínculo Conexos vs.
  robô. Invariantes U1 (token só identifica), U2 (sem autoescalada), U3 (503 nunca desloga).
  `password_hash`, `conexos_password_enc` e `auth_user_id` declarados como não expostos.

**`entities/atividade-usuario.md`**
- ANTES: não existia.
- DEPOIS: read model `planned`, sem tabela. Forma da linha
  `{em, frente, acao, alvoTipo, alvoId, valor?, status, fonte, fonteId}`; tabela das 9 fontes (ator,
  `em`, status normalizado, valor, frente); KPIs por frente; semana = grade de `metricas_ciclo`
  (sexta 18:00 SP, semiaberta); regras A1–A6 de atribuição e datação; invariantes I1–I7, incluindo:
  alvo só da identidade autenticada, sem autoescalada, nunca "pago" sem `situacao='PAGO'` (fin064,
  ADR-0055), 503 nunca desloga, credenciais nunca saem, números batem com `/metricas`.

**`decisions/0058-…md`**
- ANTES: não existia.
- DEPOIS: ADR `addition` com 7 decisões e a tabela de rejeições.

**`_index.json`**
- ANTES: `_meta.version = "0.31.0"`, `last_feature = "sync-status-lote-sispag"`, 21 entidades.
- DEPOIS: `version = "0.32.0"`, `generated = 2026-10-01`, `last_feature = "perfil-usuario"`, nota
  v0.32.0 prefixada; `entities.Usuario` (implemented, 10 impl_files) e `entities.AtividadeUsuario`
  (planned, 4 impl_files, 3 marcados "a criar").

**`_coverage.json`**
- ANTES: `entities_total 19, custom 19, implemented 12, planned 5, coverage_pct 63`.
- DEPOIS: `entities_total 21, custom 21, implemented 13, planned 6, coverage_pct 62`; `by_entity`
  ganha `Usuario` (100%) e `AtividadeUsuario` (0%). O drift pré-existente (summary/by_entity não
  contam JobRun, Alerta, BoletoDda) foi mantido e registrado na nota.

**`CHANGELOG.md`**
- DEPOIS: entrada "v0.32.0 — Usuário e atividade do usuário".

### Decisões do orquestrador aplicadas, e onde divergem da entrevista

- **P1-4 (mudou o default da entrevista).** Permutas usa a **mesma regra de `metricas_ciclo`**: só
  execução com borderô finalizado (`bor_vld_finalizado = 1`, não estornado) entra no R$. A entrevista
  propunha não filtrar. Acrescentei o secundário "N aguardando borderô finalizado" para que a baixa
  feita não suma da tela.
- **Contador de Permutas = "concluídas" do `/metricas` (correção do orquestrador, 2026-10-01).** O
  número principal é `settled` com borderô finalizado, idêntico ao "concluídas" de `metricas_ciclo`.
  O R$ usa as mesmas linhas da métrica (`settled` + `parcial`, borderô finalizado). Secundários:
  "N parciais" (parcial finalizada, entra no R$), "N aguardando borderô finalizado" (sucesso sem
  borderô finalizado, fora do número e do R$) e "N com erro". Contador e R$ batem com `/metricas`.
- P1-1, P1-2, P1-3 e o rótulo "Adiantamentos": aplicados como decididos.

### Docs (Parte 9)

Não alterei `docs/` nem o `CLAUDE.md` (escopo mínimo). O CLAUDE.md ainda diz "20 entities (v0.1)",
um drift antigo, anterior a esta feature.
