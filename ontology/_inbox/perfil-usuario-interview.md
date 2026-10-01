# Interview Transcript — perfil-usuario — 2026-10-01

**Mode:** new
**Entity affected:** Usuário da plataforma (`app_user` + papel + exceções; hoje sem arquivo em
`ontology/entities/`, documentado só nas ADRs 0051/0053/0057) e um novo read model
**AtividadeUsuario** (histórico unificado + KPIs pessoais, sem tabela nova).
**Conduzida:** sem Q&A ao vivo. O spec do usuário é detalhado e as 4 perguntas abertas (Q1–Q4) já
foram respondidas. Cada ponto abaixo foi resolvido contra o código (migrations, rotas, front) em vez
de ser perguntado. Branch base: `feat/perfil-usuario` @ `3cf24c6`.

### Summary

Uma página pessoal `/perfil` (pt-BR) onde o analista logado vê quem ele é (identidade, papel, vínculo
Conexos), o que pode fazer (permissões efetivas e a origem de cada uma), o que fez (KPIs por frente e
um histórico unificado das próprias ações) e, futuramente, troca a própria senha (seção desabilitada
"em breve" até o backend `feat/auth-senha-propria` existir). O ponto de entrada é um menu de avatar no
header do AppShell, que substitui o `UserMenu` atual. O backend ganha três rotas só de leitura sob
`/me` (`GET /me`, `GET /me/atividade`, `GET /me/historico`). A identidade vem **só** de `req.user` /
`req.acesso`, um repositório UNION ALL normaliza 10 fontes de auditoria e um serviço recebe o
`userId`/`username` alvo como parâmetro interno para que a v2 (admin vê perfil de outro) o reutilize
sem refatorar. Nenhuma escrita, nenhuma chamada ao Conexos, nenhuma tabela nova. Só índices novos.

---

## Axis 1 — Entity

**E1. Identidade = `app_user.username`, para sempre.** O token só identifica. O `resolverAcesso`
reescreve `req.user = { sub: app_user.username, authUserId?, filiais? }` e põe
`req.acesso = { userId, papel, permissoes }` (`src/backend/http/acesso.ts:196-203`,
`src/backend/http/auth.ts:20-45`). `email`/`role` do token nunca chegam a `req.user`
(`auth.ts:34-38`, "Legado: nunca é preenchido"). `username` é imutável: `PATCH /usuarios/:id/email`
"Nunca edita `username` (I1)" (`src/backend/routes/usuarios.ts:166`). O login assina `sub = username`
do banco (`src/backend/domain/service/auth/AuthService.ts:102-117`). Logo o ator gravado é o username
canônico, e o casamento exato `= $username` é seguro.

**E2. Colunas de `app_user`** (verificadas):
| coluna | origem | nota |
|---|---|---|
| `id SERIAL`, `username TEXT UNIQUE`, `password_hash`, `role` (legado, sem uso p/ authz), `created_at TIMESTAMPTZ` | `0007_app_user.sql:4-10` | "membro desde" = `created_at` |
| `ativo BOOLEAN`, `created_by TEXT` (username do admin) | `0028_app_user_gestao.sql:8-9` | `created_by` NULL p/ usuários de seed |
| `conexos_username`, `conexos_password_enc` | `0029_app_user_conexos_vinculo.sql:8-9` | ambos NULL = sem vínculo → robô. **`conexos_password_enc` nunca sai no `/me`** |
| `email`, `email_updated_by`, `email_updated_at` | `0064_app_user_email.sql:34-36` | e-mail pode ser NULL (transição) → mostrar "não cadastrado" |
| `role_id INT NOT NULL → app_role` | `0066_auth_permissoes_modulo.sql:111-117` | um papel por usuário |
| `auth_user_id UUID NULL` | `0071_app_user_auth_user_id.sql:18-23` | não exibir |

**E3. Papéis e exceções.** Não existe tabela `papel`/`role`: são `app_role(id, nome, descricao,
created_at)` e `app_role_permission(role_id, permission)` (`0066:45-62`). Exceções:
`user_permission(user_id, permission, efeito ∈ {conceder, revogar}, concedido_por TEXT, concedido_em)`,
PK `(user_id, permission)`, e "revogar vence" (`0066:64-75`). Catálogo atual com 10 permissões,
incluindo `sispag:aprovar_destino` (`0068_sispag_aprovar_destino.sql:30-47`). A regra de implicação
"executar ⇒ ver" está em `EffectivePermissionCalculator.ts:69-70`. Então a origem de uma permissão tem
**4** valores, não 2: `papel`, `concedida` (por X em data), `revogada` (por X, aparece como ausente
com motivo) e `implicada` (por `<módulo>:executar`). O `ACCESS_STATE_SELECT` atual **não** traz
`concedido_por`/`concedido_em` (`src/backend/domain/repository/auth/AccessRepository.ts:94-111`),
então o `/me` precisa de uma consulta própria (ou de uma extensão desse SELECT).

**E4. Trilha de acesso.** `app_user_access_event(id, ator TEXT, alvo_user_id INT, tipo ∈ {papel,
excecao, ativo}, antes JSONB, depois JSONB, em TIMESTAMPTZ)`, append-only (`0066:79-91`). O ator é um
username e o alvo é um id: o filtro "eu sou ator OU alvo" usa `ator = $username OR alvo_user_id =
$userId`.

**E5. Ontologia.** `ontology/entities/` não tem entidade de usuário nem de permissão (21 arquivos,
todos de domínio financeiro). A AtividadeUsuario é um **read model novo** (projeção de 10 ledgers),
com regras próprias de atribuição e datação (abaixo). Por isso `entity_changed: true`: o
OntologyCurator precisa documentar o read model e, de preferência, uma entidade `usuario.md` que
consolide as ADRs 0051/0053/0057.

## Axis 2 — Action

**A1. Ações:** só leitura. `GET /me`, `GET /me/atividade?inicio&fim`,
`GET /me/historico?cursor&frente&tipo&status&inicio&fim`. Precondição: `somenteAutenticado()` (o
mesmo guard de `/me/permissoes`, `src/backend/routes/me.ts:19-60`). Pós-condição: nenhuma mudança de
estado. Idempotentes por definição. Sem write-back ao Conexos.

**A2. Onde montar:** o `meRouter` já está montado em `/me`, depois do auth, do `resolverAcesso` e da
identidade Conexos (`src/backend/http/buildApp.ts:128-180`). As rotas novas entram nele como handlers
finos que delegam a `PerfilService` (`@injectable`) → `AtividadeUsuarioRepository` (SQL
parametrizado) → `PostgreeDatabaseClient`. A resolução é sob demanda no handler, como o
`AccessService` (não registrar efeitos no `bootstrapAppContainer`, ver Gotchas no CLAUDE.md).
`/me/conexos-status` e `/me/permissoes` já existem e são reutilizados pelo front.

**A3. Assinatura do serviço (Q4 → v2-ready):**
`PerfilService.historico({ alvo: { userId, username }, filtros, cursor })` e
`PerfilService.atividade({ alvo, inicio, fim })`. Em v1 a rota monta `alvo` **exclusivamente** de
`req.acesso.userId` + `req.user.sub`. Nenhum parâmetro de query ou de path pode sobrescrever isso.
Sem rota `:id` em v1.

## Axis 3 — Invariant

- **I1 Sem autoescalada.** A página não tem nenhum controle de escrita de papel/exceção/vínculo/
  e-mail, nem para admin. O único caminho de mudança continua sendo `/usuarios` (`usuarios:gerenciar`).
  A página só *linka* para lá.
- **I2 Nunca vazar outro usuário.** O alvo vem só de `req.user`/`req.acesso`. Os parâmetros de query
  passam por um Zod estrito (`.strict()`): parâmetros desconhecidos como `userId`/`username` são
  rejeitados com 400, não ignorados. Teste obrigatório: dois usuários com linhas em todas as fontes,
  e o `/me/historico` de A não devolve nenhuma linha em que A não seja ator (ou alvo, no
  access_event). `conexos_password_enc` e `password_hash` nunca são selecionados.
- **I3 401 ≠ 422 ≠ 503.** 401 = sessão inválida/usuário inativo (o front abre o modal de sessão
  encerrada). 503 = falha ao verificar acesso (`acesso.ts:166-169`, fail-closed): **nunca desloga**,
  e a seção mostra "não foi possível verificar". Filtro inválido = **400** (convenção:
  `routes/metricas.ts:51`). O futuro "senha atual inválida" é **422 SENHA_ATUAL_INVALIDA**,
  justamente para não cair no tratamento de 401 do `apiFetch`.
- **I4 Falha de permissões ≠ sem acesso.** `PermissoesProvider` expõe `falhou: boolean`
  (`src/frontend/lib/auth/PermissoesProvider.tsx:23-28, 93`), e `ExigePermissao` já segue o padrão
  (`components/auth/ExigePermissao.tsx:12-25`). As seções 2 e 3 usam `falhou` → "não foi possível
  verificar" + `recarregar()`.
- **I5 Vocabulário SISPAG.** Nunca "pago" sem confirmação. "remessado" = remessa `settled` gerada
  por nós. "agendado" = item `situacao='AGENDADO'` (o .RET prova só isso). "pago confirmado" =
  `situacao='PAGO'` (gravada pela sincronização, ADR-0055, a partir da baixa do título no ERP,
  `0069_sispag_item_situacao_sincronizacao.sql:31-40`). A remessa é "gerada", não "enviada": o
  Conexos não transmite (`0049_sispag_remessa_retorno.sql:33-36`).
- **I6 Só sucesso terminal no número principal.** `dry_run = true` nunca conta. Linhas em voo
  (`pending`/`reconciling`) também não. `error` vira o secundário "N com erro".
- **I7 Datação pelo encerramento (Q3).** Usar `COALESCE(encerrado_em, criado_em)` onde a coluna
  existe (mesma regra da ADR-0052). Nunca `atualizado_em` onde há alternativa, porque ele anda com o
  re-clique (`0065:15-19`). Exceções na tabela de fontes.
- **I8 Semana = a de `metricas.metricas_ciclo()`**, para os números baterem com `/metricas` (abaixo).
- **Blast radius:** baixo. Leitura pura sobre ledgers. O pior caso é um KPI errado na tela pessoal ou
  o vazamento da trilha de outro usuário (I2, por isso o teste dedicado).

### Definição de semana (verificada)

`metricas.metricas_ciclo(p_serie_inicio timestamp, p_agora timestamp)` gera janelas de 7 dias com
`generate_series(p_serie_inicio, p_agora, '7 days')` (`0070_metricas_ciclo_sispag.sql:83-91`) sobre
`timestamp` **sem fuso, em horário de São Paulo**. A âncora `metricas.serie_inicio()` =
`2026-09-11 18:00` (`0058_vw_metricas_ciclo.sql:74-80`) e o piso do histórico = `2026-08-07 18:00`
(`0060_metricas_historico_inicio.sql:54`), ambos **sexta-feira 18:00**. "Janela sexta 18:00 → sexta
18:00 em horário de São Paulo" (`0058:42-44`). Cada execução é datada por
`COALESCE(encerrado_em, criado_em) AT TIME ZONE 'America/Sao_Paulo'`, com intervalo semiaberto
`[início, fim)`. **"Esta semana" no perfil = [última sexta 18:00 SP ≤ agora, agora).** A tela deve
dizer "desde sex 18:00" para não parecer bug. "Hoje" = [00:00 SP de hoje, agora). "Este mês" =
[dia 1 00:00 SP, agora). "Personalizado" = datas locais SP, `fim` exclusivo (dia seguinte 00:00). Por
frente, a função usa: Permutas `permuta_alocacao_execucao.COALESCE(encerrado_em, criado_em)`;
Recebimentos `solicitacao_numerario_execucao.COALESCE(encerrado_em, criado_em)`; SISPAG a **1ª**
`remessa_execucao` `settled` não-dry do lote, `COALESCE(encerrado_em, criado_em)`
(`0070:166-186`).

### Fontes do histórico — mapeamento por fonte

Convenções do read model: `{em, frente, acao, alvo_tipo, alvo_id, valor, status}`, com status
normalizado ∈ `sucesso | erro | em_andamento | cancelado | info`. Frente ∈ `permutas | sispag |
recebimentos | plataforma`. Todas as fontes filtram `dry_run = false` quando a coluna existe.

| # | Tabela (migration) | Ator | `em` | Status → normalizado | Valor | Frente | Ação (rótulo) | alvo_tipo / alvo_id → link |
|---|---|---|---|---|---|---|---|---|
| 1 | `permuta_alocacao_execucao` (0015, 0056, 0065) | `executado_por` | `COALESCE(encerrado_em, criado_em)` | settled→sucesso; parcial→sucesso (badge "parcial"); error→erro; pending/reconciling→em_andamento | `valor_baixado` (BRL) | permutas | "Baixa de permuta" | `adiantamento` / `adiantamento_doc_cod` (+ invoice no detalhe) → `/permutas` |
| 2a | `permuta_excecao_manual` (0059) | `criado_por` | `criado_em` | info | — | permutas | "Marcou permutado fora do painel" | `adiantamento` / `adiantamento_doc_cod` → `/permutas` |
| 2b | idem | `removido_por` | `removido_em` | info | — | permutas | "Desfez exceção de permuta" | idem |
| 3a | `lote_pagamento` (0023, 0026, 0049) | `criado_por` | `criado_em` | status atual: CANCELADO→cancelado; demais→info | — | sispag | "Criou lote" | `lote` / `id` (UUID) + `fil_cod` → `/sispag` |
| 3b | idem | `finalizado_por` | `finalizado_em` | CANCELADO→cancelado; senão sucesso | soma `lote_pagamento_item.valor` | sispag | "Finalizou lote" | idem |
| 4 | `lote_pagamento_item_destino_audit` (0067, 0068) | `alterado_por` | `alterado_em` | info | — | sispag | `evento`: GRAVACAO→"Gravou destino de pagamento", APROVACAO→"Aprovou destino manual" | `titulo` / `fil_cod-doc_cod-tit_cod` (lote `lote_id`) → `/sispag` |
| 5 | `remessa_execucao` (0049, 0051, 0070) | `executado_por` | `COALESCE(encerrado_em, criado_em)` | settled→sucesso; error→erro; pending/reconciling→em_andamento | **não tem coluna de valor**: soma `lote_pagamento_item.valor` do `lote_id` | sispag | "Gerou remessa" | `lote` / `lote_id` → `/sispag` |
| 6 | `conciliacao_execucao` (0050) | `executado_por` | **`atualizado_em`** (não tem `encerrado_em`) | settled→sucesso (badge "parcial" se `varredura_incompleta`); error→erro; pending/reconciling→em_andamento | — (tem contagens `pagos`/`rejeitados`/`total_linhas`, não R$) | sispag | "Conciliou retorno" | `retorno` / `fil_cod-bnc_cod-gtb_cod_seq-gar_cod_seq` → `/sispag` |
| 7 | `solicitacao_numerario_execucao` (0041, 0042, 0065) | `executado_por` | `COALESCE(encerrado_em, criado_em)` | settled→sucesso; error→erro; pending/reconciling→em_andamento | `valor` NUMERIC(18,2) | recebimentos | "Executou solicitação de numerário" | `processo` / `pri_cod` (+ `doc_cod`) → `/recebimentos` |
| 8 | `alerta` (0052, 0069) | `reconhecido_por` | `reconhecido_em` | info | — | plataforma | "Reconheceu alerta" (+ `tipo`) | `alerta` / `id` (+ `alvo`) → `/operacao` |
| 9 | `app_user_access_event` (0066) | `ator` **ou** `alvo_user_id` | `em` | info | — | plataforma | ator=eu: "Alterou acesso de <alvo>" (`tipo`); alvo=eu: "Seu acesso foi alterado por <ator>" | `usuario` / `alvo_user_id` → `/usuarios` só se `usuarios:gerenciar` |

Notas da tabela:
- **Q2 aplicado:** o lote conta para quem o **finalizou** (`finalizado_por`). Atenção: voltar o lote
  a RASCUNHO **apaga** `finalizado_por/finalizado_em`
  (`src/backend/domain/repository/sispag/LotePagamentoRepository.ts:782-783`). Só a última
  finalização vigente é atribuível. Não existe `cancelado_por`/`cancelado_em`: o cancelamento não
  tem autor nem data.
- **Q1 aplicado:** o R$ do SISPAG é o **remessado pelo usuário**, ou seja,
  `SUM(lote_pagamento_item.valor)` (snapshot da inclusão, a mesma grandeza que a 0070 usa) dos lotes
  cuja **1ª** remessa `settled` não-dry foi executada pelo usuário no período. Com a 1ª remessa, um
  lote com dois `settled` não conta duas vezes. Secundários baratos sobre os mesmos itens: "agendado"
  (`situacao IN ('AGENDADO','PAGO')`) e "pago confirmado" (`situacao='PAGO'`).
- **Q3 aplicado / verificado:** têm carimbo de encerramento `permuta_alocacao_execucao`,
  `solicitacao_numerario_execucao` (0065:53-57) e `remessa_execucao` (0070:38-39). **Não têm:**
  `conciliacao_execucao` (só `criado_em`/`atualizado_em`, e `atualizado_em` também anda no
  `processou = TRUE`, `ConciliacaoExecucaoRepository.ts:98,120,135,155`). Os eventos 2/3/4/8/9 são
  pontuais: o próprio timestamp já é o do fato. A SN antiga (pré-0065) não tem backfill e cai no
  `criado_em` (`0065:58-63`), igual à métrica.
- **Ator nunca é o robô.** `executado_por` é sempre o username **da plataforma** (`req.user.sub`,
  ex.: `routes/sispag.ts:108`, `routes/permutas.ts:637`, `routes/recebimentos.ts:265`). Quem assinou
  no ERP fica em `conexos_username`/`conexos_usn_cod` (0051), com o robô gravado pelo nome. NULL
  significa "não capturado", nunca "robô" (`0051:12-14`). Um usuário sem vínculo **vê** as próprias
  execuções normalmente. O histórico pode exibir "assinado no ERP como <conexos_username>" quando
  difere do vínculo dele (P2, barato).
- **Valores sentinela de ator:** `'unknown'` (fallback `req.user?.sub ?? 'unknown'` nas rotas) e
  `'dev-bypass'` (`acesso.ts:72`). Nunca casam com um username real. Nada a filtrar.
- **Fora do escopo do histórico (de propósito):** `solicitacao_numerario` (0032, a sexta ledger da
  trilha com299→fin014 de **Permutas**, `0051:36-44`) e `recebimento_execucao` (spine vazia em
  produção). Ver residual P1-3.

### KPIs (seção 3) — regras extraídas

| Frente (gate) | Número principal | R$ | Secundário |
|---|---|---|---|
| Permutas (`permutas:ver`) | execuções `settled`+`parcial`, não-dry, do usuário, no período | `SUM(valor_baixado)` das mesmas | "N com erro" (`status='error'`) |
| SISPAG (`sispag:ver`) | lotes finalizados (`finalizado_por`, `finalizado_em` no período, `status<>'CANCELADO'`); remessas geradas (1ª `settled` por lote); retornos conciliados (`conciliacao_execucao` `settled`) | R$ remessado (Q1) | R$ agendado / R$ pago confirmado; "N com erro" (remessa + conciliação `error`) |
| Recebimentos (`recebimentos:ver`) | `solicitacao_numerario_execucao` `settled`, não-dry | `SUM(valor)` | "N com erro" |

A comparação com o período anterior (↑/↓) é barata: a mesma consulta com `[inicio-(fim-inicio),
inicio)`. Uma ida ao banco por frente, ou uma só com `FILTER`.

### Índices existentes em (ator, tempo) — verificado

Só existe **`idx_app_user_access_event_alvo_em (alvo_user_id, em)`** (`0066:90`). **Nenhuma** das
outras 9 fontes tem índice por ator. Os existentes são por status, lote, pri_cod, adto, txn e
dedup (`0015:38-41`, `0041:36-37`, `0049:99-100`, `0050:38-40`, `0052:42-46`, `0067:45`). Proposta:
uma migration nova de índices, com o número checado contra a `main` no momento (há colisão de
numeração entre sessões paralelas):
`permuta_alocacao_execucao(executado_por, encerrado_em)`, `solicitacao_numerario_execucao
(executado_por, encerrado_em)`, `remessa_execucao(executado_por, encerrado_em)`,
`conciliacao_execucao(executado_por, atualizado_em)`, `lote_pagamento(finalizado_por,
finalizado_em)`, `lote_pagamento(criado_por, criado_em)`, `permuta_excecao_manual(criado_por)`,
`lote_pagamento_item_destino_audit(alterado_por, alterado_em)`, `alerta(reconhecido_por,
reconhecido_em) WHERE reconhecido_por IS NOT NULL`, `app_user_access_event(ator, em)`. Os volumes
são de centenas de linhas (ex.: 190 execuções de permuta, 10 remessas, citados em 0065/0070), então
o EXPLAIN do PR provavelmente mostra Seq Scan mesmo com o índice. Isso é esperado e deve ser dito no
PR, não "corrigido". Só aditiva, sem reverse.

**Paginação:** keyset por `(em DESC, fonte, id DESC)`. O cursor é opaco (base64 de `{em, fonte, id}`),
validado por Zod. A ordem estável exige o desempate por `(fonte, id)`, porque os ids de tabelas
diferentes colidem. Limite de 25. Default dos últimos 30 dias.

## Axis 4 — Integration

- **Sistemas externos:** nenhum. Os KPIs e o histórico leem só os nossos ledgers (Postgres/Supabase).
  Nada de Conexos, Nexxera ou SharePoint. `/me/conexos-status` (já existente) é o único que toca o
  ERP, e já existe.
- **Contrato de API:** só aditivo (3 GETs novos em `/me`). `/me/permissoes` e `/me/conexos-status`
  ficam inalterados.
- **Senha:** `GET /me/senha/politica` e `POST /me/senha` **não existem** e estão fora do escopo. O
  front desenha a seção desabilitada "em breve", sem chamar nada, e o teste do mapeamento de erros
  (204/400 POLITICA/422/429/503) roda contra um endpoint mockado.
- **SSM/env:** nenhum parâmetro novo. **Tenant:** um só (Columbia), sem variação.
- **Frontend: fatos verificados**
  - `UserMenu` atual: username (escondido < sm) + botão "Sair", e não renderiza nada em dev-bypass
    ou sem sessão (`src/frontend/components/auth/UserMenu.tsx:14-37`). É montado no header em
    `AppShell.tsx:278`. Sidebar `hidden md:block` (`AppShell.tsx:163`), `BottomNav` `md:hidden`
    (`:238`).
  - `useAuth()` só expõe `username` (sem e-mail nem papel) (`lib/auth/AuthProvider.tsx:39-41`). O
    papel vem de `usePermissoes().papel` e o e-mail vem do novo `GET /me`.
  - **Não existe primitivo DropdownMenu nem Avatar.** O DS os lista (`docs/design-system/
    atomic-classification.md:25,62`), mas não há `components/ui/dropdown-menu.tsx`/`avatar.tsx` e o
    `@radix-ui/react-dropdown-menu` **não** está instalado (instalados: checkbox, collapsible, dialog,
    label, popover, select, slot, switch, tabs, tooltip). Existem `badge`, `empty-state`, `skeleton`,
    `tabs`, `tooltip`, `popover`, `kpi-card` (`KPIGrid`, `SimpleKPI` com `label/value/footer/color`,
    `components/ui/kpi-card.tsx:157-199`), `page-header`, `card`, `table`. Não existe
    `Callout`/`Alert`: o aviso "sem vínculo" usa o padrão de `ConexosStatusBanner.tsx` ou um Card de
    aviso com tokens de warning.
  - **Rótulos de permissão NÃO estão em `lib/permissoes.ts`** (o arquivo tem só códigos e o catálogo,
    72 linhas). O agrupamento e os rótulos (`MODULOS`: Permutas / SISPAG / **Adiantamentos** /
    Operação / Métricas / Usuários, com ações "ver", "executar", "aprovar destino manual") vivem em
    `app/usuarios/EditarAcessoDialog.tsx:48-71`. O nav chama a Frente IV de **"Adiantamentos"**
    (`components/nav/app-nav.tsx:77`) e agrupa "Frentes" / "Plataforma". Decisão: extrair `MODULOS`
    para `lib/permissoes.ts` e reutilizá-lo nos dois lugares.
  - Tabs vs. cards empilhados: o DS dá `DetailLayout` com Tabs para detalhe de entidade
    (`docs/design-system/layout.md:309-345`) e diz que seções sem permissão são **omitidas**
    (`layout.md:307`). **Decisão: cards empilhados**, porque `/perfil#senha` precisa ser uma âncora
    nativa, cada seção carrega e falha de forma independente e a página é curta. Em mobile, o
    histórico vira cards.
  - Nenhuma página aceita query de deep link hoje (só `/login` usa `useSearchParams`). Os links do
    histórico vão para a página da frente, ver residual P1-2.
  - Precedente de `localStorage` com try/catch e estrutura de KPIs: `app/metricas/page.tsx:6,127-170`.

---

### Decisions taken

1. Identidade só de `req.user.sub` + `req.acesso.userId`. O serviço recebe `alvo` como parâmetro
   interno (Q4/v2) e não há rota `:id` em v1. O Zod `.strict()` recusa `userId`/`username` na query.
2. Lote atribuído a `finalizado_por` (Q2). R$ SISPAG = `SUM(lote_pagamento_item.valor)` dos lotes
   remessados pelo usuário, só a 1ª remessa `settled` (Q1). Lotes CANCELADO ficam fora do número
   principal, como na 0070.
3. Datação por `COALESCE(encerrado_em, criado_em)` (Q3). `conciliacao_execucao` usa `atualizado_em`
   (documentado como aproximação, residual P1-1).
4. Semana = grade sexta 18:00 → sexta 18:00, America/Sao_Paulo, intervalo semiaberto, idêntica à de
   `metricas_ciclo`.
5. Permutas: sucesso = `settled`+`parcial`. **Não** exige borderô finalizado (diferente de
   `/metricas`), residual P1-4.
6. Origem de permissão em 4 valores (papel / concedida por X / revogada por X / implicada por
   executar). Consulta própria com `concedido_por`/`concedido_em`.
7. Cards empilhados. Novo `components/ui/dropdown-menu.tsx` sobre `@radix-ui/react-dropdown-menu`
   (dependência nova) + `avatar.tsx` de iniciais (sem Radix). Rótulos extraídos para
   `lib/permissoes.ts`.
8. O histórico mostra todas as ações do próprio usuário, mesmo de frentes cuja permissão `ver` ele
   perdeu (é a trilha dele). O link fica oculto sem `<frente>:ver`. Os tiles de KPI são gated por
   `<frente>:ver`, conforme o spec.
9. Migration só de índices (aditiva), com EXPLAIN no PR.
10. A seção de senha fica desabilitada ("em breve"). O mapeamento de erros fica pronto e testado
    contra mock.

### Extracted rules

- R1: Toda leitura do perfil é escopada ao usuário autenticado. Nenhum input do cliente escolhe o alvo.
- R2: KPI principal = só sucesso terminal, não-dry. `error` aparece como secundário com link para o
  histórico filtrado por `status=erro`.
- R3: A data de uma execução é a do seu encerramento (`COALESCE(encerrado_em, criado_em)`). Eventos
  pontuais usam o próprio carimbo.
- R4: Lote SISPAG pertence a quem o finalizou. O valor remessado é o snapshot dos itens.
- R5: Vocabulário SISPAG: remessado / agendado / pago confirmado. Nunca "pago" sem `situacao='PAGO'`.
- R6: Sem vínculo Conexos, as ações aparecem no histórico do usuário mesmo assim. O ERP as registra
  como robô CLONEX, e a tela avisa isso.
- R7: 503 de verificação de acesso nunca desloga. Erro de verificação de permissões ≠ "sem acesso".
- R8: Nenhuma edição de identidade, papel, exceção ou vínculo na página, para nenhum papel.

### entity_changed: true
### Ontology diff needed: yes
- Novo read model `ontology/entities/atividade-usuario.md` (ou em `ui-flows/perfil-usuario.md` +
  regra de negócio), com a tabela de fontes, as regras R2–R5 e a definição de período/semana.
- Recomendado: `ontology/entities/usuario.md` consolidando `app_user`/papel/exceção/trilha (hoje só
  em ADRs 0051/0053/0057), com `implemented: true`.
- `_index.json`: mapear os arquivos novos (rota `/me`, `PerfilService`, `AtividadeUsuarioRepository`,
  `app/perfil`). ADR curta para as decisões 2, 3, 5 e 8.
### Reason: new read model (no new table; additive indexes only)

### ground_truth: SEM_GROUND_TRUTH
Não há lógica monetária nova contra o ERP: os KPIs são `SUM`/`COUNT` de valores **já gravados nos
nossos ledgers**, no momento do fato, e reconsultar o Conexos mediria outra coisa. É o mesmo veredito
do precedente `metricas-ciclo` (`ontology/_inbox/metricas-ciclo-tasks.md:10-12`, "SEM_GROUND_TRUTH
contra o ERP, por construção"). **Gate substituto recomendado:** equivalência read-only contra o
ledger vivo (`BEGIN TRANSACTION READ ONLY`). Para 2–3 usuários reais e semanas fechadas, comparar o
`/me/atividade` com uma consulta independente escrita à parte (contagem por status, `SUM`), com
tolerância zero. Para um usuário inteiro, a soma "Permutas R$" em semanas fechadas, sem o filtro de
borderô, deve ser ≥ ao valor da `metricas_ciclo` atribuível a ele (sanidade cruzada).

---

## Residual questions for the user

Nada é P0: o spec + Q1–Q4 + o código resolvem tudo o que bloqueia. Ficam quatro P1, cada um com um
default que o loop aplica se não houver resposta.

- **P1-1. Conciliação sem `encerrado_em`.** A `conciliacao_execucao` só tem `atualizado_em`, que
  também anda em escritas pós-conclusão (`processou = TRUE`). *Default:* datar por `atualizado_em`
  nesta feature e registrar a aproximação. O carimbo `encerrado_em` (padrão 0065/0070, tocando o
  repositório de escrita) vira follow-up, porque mexer num write path money-adjacent está fora do
  escopo "só leitura".
- **P1-2. Deep links.** Nenhuma página aceita hoje `?lote=`/`?adto=`/`?pri=`. *Default:* o link leva
  à página da frente (`/permutas`, `/sispag`, `/recebimentos`, `/operacao`, `/usuarios`) e o id do
  alvo aparece em texto copiável. Deep link com foco no item fica como follow-up.
- **P1-3. Escopo das ledgers.** A `solicitacao_numerario` (com299 da trilha de **Permutas**) não
  está na lista do spec. *Default:* fora da v1, porque a Permuta já aparece via
  `permuta_alocacao_execucao`, e entra como follow-up se o usuário quiser ver cada passo com299.
- **P1-4. Permutas: exigir borderô finalizado?** O `/metricas` só conta R$ com borderô finalizado
  (G2), então a soma pessoal pode ser maior que a fatia dele no `/metricas`. *Default:* o perfil
  conta `settled`+`parcial` sem o filtro de borderô (é "o que eu baixei") e mostra no footer do tile
  "inclui baixas com borderô ainda não finalizado". A alternativa é espelhar a métrica.
- (Menor, sem pergunta) O nome do grupo da Frente IV segue o nav: **"Adiantamentos"**, não
  "Recebimentos" como no spec, porque a tela deve usar o rótulo que o usuário já vê. Inverter se o
  usuário preferir.

**Handoff:** `entity_changed: true` → **OntologyCurator** (read model + `usuario.md` + ADR), depois
TaskScoper.
