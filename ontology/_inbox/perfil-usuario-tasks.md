# Tasks: perfil-usuario

**Spec source:** ontology/_inbox/perfil-usuario-interview.md
**Ontology diff:** yes — `ontology/entities/usuario.md` (novo), `ontology/entities/atividade-usuario.md` (novo), `ontology/decisions/0058-perfil-do-usuario-le-a-atividade-dos-ledgers.md` (novo), `ontology/_index.json`, `ontology/_coverage.json`, `ontology/CHANGELOG.md` (v0.32.0). Resumo em `ontology/_inbox/perfil-usuario-ontology-diff.md`.
**entity_changed:** true (diff presente)
**Estimated scope:** L (1 migration de índices + 2 repositórios + 1 serviço + 3 rotas GET + 2 primitivos de UI + menu de avatar + página com 5 seções + script de equivalência)

> **Layout real:** `src/backend/` e `src/frontend/`. Não há `infra/` → AwsInfraArchitect **não** é acionado.
> **Só leitura.** Nenhuma escrita, nenhuma chamada ao Conexos/Nexxera/SharePoint, nenhuma tabela nova.
> **Ground truth:** `SEM_GROUND_TRUTH` (os KPIs somam valores já gravados nos nossos ledgers; mesmo
> veredito do `metricas-ciclo`). Gate substituto: equivalência read-only contra o ledger vivo (Task 16).
> **Correção do orquestrador aplicada (2026-10-01):** Permutas, número principal = `settled` com
> borderô finalizado (idêntico ao "concluídas" do `/metricas`); R$ = `settled` + `parcial` com borderô
> finalizado (as mesmas linhas do `/metricas`); secundários "N parciais", "N aguardando borderô
> finalizado", "N com erro".

### Fatos verificados que moldam as tasks

- `GET /me` (raiz) **não existe hoje**: o `meRouter` (`src/backend/routes/me.ts`) só tem
  `/conexos-status` e `/permissoes`. Criar `GET /me` é aditivo e não quebra consumidor nenhum. As duas
  rotas existentes ficam inalteradas.
- Maior migration na `origin/main` (= `3cf24c6`) é `0071` → próxima livre **`0072`** (reconferir após
  rebase: há colisão de numeração entre sessões paralelas).
- O `MigrationRunner` aplica cada migration dentro de `withTransaction` → **`CREATE INDEX CONCURRENTLY`
  é incompatível** (o Postgres o recusa dentro de bloco de transação). Precedente explícito:
  `0048_idx_solicitacao_numerario_execucao_filial.sql:12` ("Sem CONCURRENTLY: o BootMigrator roda em
  transação, antes de aceitar tráfego"). Volumes de centenas de linhas → lock de build desprezível.
- O build já copia todo `NNNN_*.sql` do nível de cima (`migrations/MigrationFiles.ts` +
  `copy-to-dist.ts`): a `0072` entra sem mudar o build. O rollback vai em `migrations/rollbacks/`
  (não recursivo, nunca aplicado no boot).
- Testes de migration asseguram o **fonte** (padrão `0071_app_user_auth_user_id.test.ts`), porque o
  runner usa `import.meta` e não roda sob Jest.
- `@radix-ui/react-dropdown-menu@2.1.x` (atual 2.1.24) tem peer `react ^19` e é da mesma geração dos
  Radix instalados (`dialog ^1.1.15`, `popover ^1.1.15`, `tooltip ^1.2.8`, `select ^2.2.6`). Atenção:
  `@radix-ui/react-slot` e `@radix-ui/react-tabs` estão **fixados** (`1.1.1`, `1.1.2`); o install não
  pode alterar esses pins nem duplicar `@radix-ui/react-primitive` de forma que quebre o build.
- O papel do usuário já está em `usePermissoes().papel` (`PermissoesProvider.tsx:22,92-96`); e-mail,
  "membro desde" e vínculo vêm do novo `GET /me`.
- `metricas_ciclo` compara em `timestamp` local SP; aqui o repositório compara `timestamptz` contra
  limites `timestamptz` calculados no serviço. Equivalente porque o Brasil não tem horário de verão
  desde 2019 (conversão monotônica, offset fixo -03:00).

## Task list

### Task 1: Write failing backend tests for periods, cursor, service, repositories and routes
**Files to change:**
- `src/backend/domain/service/perfil/PeriodoPerfil.test.ts` (novo)
- `src/backend/domain/service/perfil/HistoricoCursor.test.ts` (novo)
- `src/backend/domain/service/perfil/PerfilService.test.ts` (novo)
- `src/backend/domain/repository/perfil/PerfilRepository.test.ts` (novo)
- `src/backend/domain/repository/perfil/AtividadeUsuarioRepository.test.ts` (novo)
- `src/backend/routes/me.test.ts` (estender)

**Acceptance criteria:**
- [ ] Períodos (relógio injetado, `America/Sao_Paulo`): "hoje" às 00:00:00 SP começa no próprio dia e às 23:59:59 SP ainda é o mesmo dia; "semana" na sexta 17:59:59 SP começa na sexta **anterior** 18:00, na sexta 18:00:00 SP começa nela mesma, no sábado/quinta começa na última sexta 18:00; "mês" no dia 1 00:00 SP começa nele e no dia 31 23:59 SP no dia 1 do mesmo mês; virada de ano (31/12 → 01/01); `fim` = agora em todos
- [ ] A âncora da grade semanal coincide com `metricas.serie_inicio()` (`2026-09-11 18:00` SP): todo início de "semana" calculado é âncora + k·7 dias
- [ ] "Personalizado": datas locais SP `YYYY-MM-DD`, `fim` exclusivo (dia seguinte 00:00 SP); `inicio >= fim` → erro de validação; intervalo > 366 dias → erro de validação
- [ ] Período anterior = `[inicio − (fim − inicio), inicio)` para os 4 tipos
- [ ] Cursor: encode→decode é identidade para `{em, fonte, fonteId}`; `em` preserva **microssegundos** (string do Postgres, nunca `Date` do JS); base64 inválido, JSON inválido, campos extras ou `fonte` fora do enum → erro de validação (vira 400)
- [ ] Serviço: monta `alvo` só do argumento; pede `limit + 1` (26) e devolve 25 + `proximoCursor` quando há a 26ª, `proximoCursor` ausente quando não há; mapeia status brutos → `sucesso|erro|em_andamento|cancelado|info` conforme a tabela de fontes; `dry_run` nunca chega ao resultado
- [ ] KPIs Permutas: número principal conta só `settled` com borderô finalizado; R$ soma `settled`+`parcial` finalizadas; `parcial` finalizada entra em "N parciais" e no R$, não no principal; `settled`/`parcial` sem borderô finalizado (ou estornado) só em "N aguardando borderô finalizado"; `error` só em "N com erro"; `pending`/`reconciling` em nenhum número
- [ ] KPIs SISPAG: remessa conta para o lote só se for a **1ª** `settled` não-dry do lote **entre todos os usuários** e o executor for o alvo; lote com 2 `settled` não conta 2 vezes; lote `CANCELADO` fora; R$ agendado = itens `situacao IN ('AGENDADO','PAGO')`, R$ pago confirmado = `situacao = 'PAGO'`; "N com erro" = remessa `error` + conciliação `error`
- [ ] KPIs Recebimentos: `settled` não-dry conta, `SUM(valor)`; `error` em "N com erro"
- [ ] Repositórios (mock do `PostgreeDatabaseClient`): todo SQL é parametrizado (nenhum valor de usuário interpolado no texto); o filtro de ator está **dentro de cada ramo** do UNION ALL; nenhum SQL contém `password_hash` nem `conexos_password_enc`
- [ ] Rotas: `GET /me/historico?userId=2` e `?username=x` → **400** (Zod `.strict()`), idem para `/me/atividade`; filtro inválido (`status=pago`, `frente=x`, data malformada) → 400; o serviço é sempre chamado com `alvo = { userId: req.acesso.userId, username: req.user.sub }`
- [ ] Os testes falham (módulos ainda não existem)

**Dependencies:** none

---

### Task 2: Migration 0072 with additive (actor, time) indexes for the activity sources
**Files to change:**
- `src/backend/migrations/0072_idx_atividade_usuario.sql` (novo; reconferir que 0072 é o próximo livre após rebase na main)
- `src/backend/migrations/rollbacks/0072_idx_atividade_usuario.rollback.sql` (novo; `DROP INDEX IF EXISTS`)
- `src/backend/migrations/0072_idx_atividade_usuario.test.ts` (novo; assertivas sobre o fonte)

**Acceptance criteria:**
- [ ] Só `CREATE INDEX IF NOT EXISTS`, **sem `CONCURRENTLY`** (o runner aplica em transação; comentário no topo cita a `0048`), sem DDL de tabela, sem `DROP`, sem `UPDATE`
- [ ] Índices de expressão onde o `em` é `COALESCE` (a coluna crua não serve ao predicado): `permuta_alocacao_execucao (executado_por, COALESCE(encerrado_em, criado_em))`, `solicitacao_numerario_execucao (executado_por, COALESCE(encerrado_em, criado_em))`, `remessa_execucao (executado_por, COALESCE(encerrado_em, criado_em))`
- [ ] Índices simples: `conciliacao_execucao (executado_por, atualizado_em)`, `lote_pagamento (criado_por, criado_em)`, `lote_pagamento (finalizado_por, finalizado_em) WHERE finalizado_por IS NOT NULL`, `permuta_excecao_manual (criado_por, criado_em)`, `permuta_excecao_manual (removido_por, removido_em) WHERE removido_por IS NOT NULL`, `lote_pagamento_item_destino_audit (alterado_por, alterado_em)`, `alerta (reconhecido_por, reconhecido_em) WHERE reconhecido_por IS NOT NULL`, `app_user_access_event (ator, em)` (o `(alvo_user_id, em)` já existe na 0066)
- [ ] Nomes e colunas conferidos contra as migrations de origem (0015, 0041, 0049, 0050, 0052, 0059, 0067, 0066); o teste falha se alguma coluna citada não existir no fonte da migration de origem
- [ ] Rollback dropa exatamente os índices criados, `IF EXISTS`
- [ ] Aplicada num Postgres local (`npm run migrate`) duas vezes seguidas sem erro (idempotência); EXPLAIN de uma consulta do histórico anexado ao PR, com a observação de que Seq Scan é esperado nos volumes atuais

**Dependencies:** Task 1

---

### Task 3: PerfilRepository — identity and permission origins
**Files to change:**
- `src/backend/domain/repository/perfil/PerfilRepository.ts` (novo, `@injectable()`)
- `src/backend/domain/interface/perfil/PerfilInterface.ts` (novo)

**Acceptance criteria:**
- [ ] `buscarIdentidade(userId)` seleciona só `id, username, email, ativo, created_at, created_by, conexos_username` + papel (`app_role.id, nome, descricao`); `conexos_password_enc`, `password_hash`, `auth_user_id` nunca aparecem no SQL; "vinculado" = `conexos_username IS NOT NULL`
- [ ] `buscarFontesDePermissao(userId)` devolve as permissões do papel (`app_role_permission`) e as exceções (`user_permission`) **com** `efeito`, `concedido_por`, `concedido_em`
- [ ] Linhas validadas com Zod (nulos do banco tratados: `email`, `created_by`, `conexos_username` opcionais)
- [ ] SQL parametrizado (`$1`); arrow methods, modificadores explícitos, export de classe
- [ ] Testes do repositório da Task 1 passam

**Dependencies:** Task 1

---

### Task 4: AtividadeUsuarioRepository — per-frente aggregates and unified history
**Files to change:**
- `src/backend/domain/repository/perfil/AtividadeUsuarioRepository.ts` (novo, `@injectable()`)
- `src/backend/domain/interface/perfil/AtividadeUsuarioInterface.ts` (novo)

**Acceptance criteria:**
- [ ] `agregados({ username, inicio, fim })`: uma ida ao banco com `FILTER`, intervalo semiaberto `[$inicio, $fim)`; Permutas usa **o mesmo `EXISTS` de borderô** da `0070` (`bor_vld_finalizado = 1 AND bor_cod_estornado IS NULL`) e devolve `concluidas` (settled finalizada), `parciais` (parcial finalizada), `valorBaixado` (settled+parcial finalizadas), `aguardandoBordero`, `comErro`; SISPAG devolve `lotesFinalizados` (`finalizado_por`, `finalizado_em` no período, `status <> 'CANCELADO'`), `remessasGeradas` e `valorRemessado`/`valorAgendado`/`valorPagoConfirmado` (1ª `settled` não-dry por lote via `LATERAL ... ORDER BY COALESCE(encerrado_em, criado_em) LIMIT 1`, como a 0070, filtrada depois por `executado_por = $username`), `retornosConciliados`, `comErro`; Recebimentos devolve `concluidas`, `valor`, `comErro`
- [ ] `historico({ userId, username, inicio, fim, frente?, tipo?, status?, cursor?, limit })`: UNION ALL das 9 fontes (12 ramos) normalizado em `{em, frente, acao, alvo_tipo, alvo_id, valor, status, fonte, fonte_id, detalhe}`; `fonte` é único por ramo (`permuta_execucao`, `excecao_criada`, `excecao_removida`, `lote_criado`, `lote_finalizado`, `destino_audit`, `remessa`, `conciliacao`, `sn_execucao`, `alerta_reconhecido`, `acesso_evento`); `fonte_id` em `text` (UUID e inteiros convivem)
- [ ] Ator e janela de tempo filtrados **dentro de cada ramo**; `dry_run = false` onde a coluna existe; `app_user_access_event` casa `ator = $username OR alvo_user_id = $userId` e devolve uma linha só quando o usuário é ator e alvo; o username do outro lado vem de JOIN em `app_user` selecionando só `username`
- [ ] Datação conforme A2/A3: `COALESCE(encerrado_em, criado_em)` nas fontes 1/5/7, `atualizado_em` na conciliação, carimbo próprio nas pontuais
- [ ] Filtros `frente`/`tipo`/`status` aplicados sobre as colunas normalizadas; keyset `(em DESC, fonte ASC, fonte_id DESC)` com o predicado `em < $c OR (em = $c AND (fonte > $f OR (fonte = $f AND fonte_id < $id)))`; `em` devolvido também como texto com microssegundos para o cursor; `LIMIT $n`
- [ ] `detalhe` opcional: `parcial` (permuta/conciliação com `varredura_incompleta`), `filCod`, `conexosUsername` (quem assinou no ERP), `loteId`
- [ ] Valor de remessa/lote finalizado = `SUM(lote_pagamento_item.valor)` do lote; conciliação sem valor
- [ ] Linhas validadas com Zod; SQL 100% parametrizado; nenhuma coluna de credencial
- [ ] Testes do repositório da Task 1 passam

**Dependencies:** Task 2, Task 3

---

### Task 5: PerfilService — periods, comparison, permission origins, status mapping and cursor
**Files to change:**
- `src/backend/domain/service/perfil/PeriodoPerfil.ts` (novo, `@injectable()`; relógio injetável)
- `src/backend/domain/service/perfil/HistoricoCursor.ts` (novo, `@injectable()`; base64 de JSON validado por Zod)
- `src/backend/domain/service/perfil/PerfilService.ts` (novo, `@injectable()`)

**Acceptance criteria:**
- [ ] `PerfilService.perfil(alvo)`, `PerfilService.atividade({ alvo, periodo })` e `PerfilService.historico({ alvo, filtros, cursor })` recebem `alvo = { userId, username }` como parâmetro interno (v2-ready); nada no serviço lê `req`
- [ ] Origem da permissão em 4 valores: `papel`, `concedida` (`por`, `em`), `revogada` (`por`, `em`; aparece com `efetiva: false`), `implicada` (`implicadaPor: '<modulo>:executar'`); o conjunto `efetiva = true` é calculado pelo **`EffectivePermissionCalculator` existente** (sem regra duplicada) e o teste prova igualdade com ele
- [ ] `atividade` devolve, por frente, `atual` e `anterior` (mesma consulta com o período anterior) + `periodo { inicio, fim, tipo }`; semana na grade sexta 18:00 SP
- [ ] Mapeamento de status bruto → normalizado é uma tabela única (constante tipada), não strings soltas
- [ ] Erros de validação (período, cursor) são um tipo de erro de domínio em inglês (ex.: `PerfilQueryInvalidError`) que a rota traduz em 400; mensagens ao operador em português
- [ ] Sem `process.env`, sem `!`, arrow methods, modificadores explícitos
- [ ] Testes de período, cursor e serviço da Task 1 passam

**Dependencies:** Task 3, Task 4

---

### Task 6: Thin routes GET /me, /me/atividade and /me/historico
**Files to change:**
- `src/backend/routes/me.ts` (estender; `/conexos-status` e `/permissoes` inalterados)
- `src/backend/domain/interface/perfil/PerfilQuerySchemas.ts` (novo; schemas Zod `.strict()` das queries)

**Acceptance criteria:**
- [ ] As 3 rotas usam `somenteAutenticado()` + `asyncHandler`, resolvem `PerfilService` via `container.resolve` no handler (nada registrado no `bootstrapAppContainer`, ver Gotchas), e respondem com `Cache-Control: no-store`
- [ ] `alvo` montado **exclusivamente** de `req.acesso.userId` + `req.user.sub`; sem `req.acesso` → erro interno explícito, igual a `/me/permissoes`
- [ ] Query Zod `.strict()`: `/me/atividade?periodo=hoje|semana|mes|personalizado&inicio&fim`; `/me/historico?cursor&frente&tipo&status&inicio&fim` (default últimos 30 dias); parâmetro desconhecido ou inválido → **400** com corpo `{ erro, detalhes }` (convenção de `routes/metricas.ts`)
- [ ] `GET /me` devolve `{ username, email|null, ativo, membroDesde, criadoPor|null, papel { id, nome, descricao }, conexos { vinculado, conexosUsername|null }, permissoes: [{ codigo, efetiva, origem, por?, em?, implicadaPor? }] }`; o teste assegura a ausência de `password_hash`, `conexos_password_enc`, `auth_user_id` no JSON
- [ ] Teste de isolamento: dois usuários (A e B) com linhas em todas as 9 fontes no mock de banco; `/me/historico` e `/me/atividade` de A nunca devolvem linha em que A não seja ator (ou alvo, no access_event)
- [ ] 503 do `resolverAcesso` continua acontecendo antes da rota (nenhum tratamento novo transforma falha de verificação em 401)
- [ ] Testes de rota da Task 1 passam; `npm run typecheck` e `npm run lint` em `src/backend` passam

**Dependencies:** Task 5

---

### Task 7: Write failing frontend tests
**Files to change:**
- `src/frontend/components/ui/dropdown-menu.test.tsx` (novo)
- `src/frontend/components/ui/avatar.test.tsx` (novo)
- `src/frontend/components/auth/UserMenu.test.tsx` (novo ou estender)
- `src/frontend/app/perfil/page.test.tsx` (novo)
- `src/frontend/app/perfil/SegurancaSection.test.tsx` (novo)
- `src/frontend/lib/permissoes.test.ts` (novo ou estender)

**Acceptance criteria:**
- [ ] Avatar: iniciais de `ana.souza` → "AS", de `admin` → "AD"; `aria-label` com o username
- [ ] UserMenu: abre por clique e teclado (Enter/Espaço), mostra username + nome do papel, itens "Meu perfil" (`/perfil`), "Alterar senha" (`/perfil#senha`), separador, "Sair" (chama o logout existente); nada renderiza em dev-bypass ou sem sessão (comportamento atual preservado)
- [ ] Página: cada seção tem skeleton próprio e erro independente (falha do `/me/historico` não derruba Identidade); `usePermissoes().falhou` → "não foi possível verificar" + botão recarregar nas seções Permissões e Minha atividade, nunca "sem acesso"
- [ ] Minha atividade: tiles só para frentes com `<frente>:ver`; período persistido em `localStorage` com try/catch (acesso que lança não quebra a página); ↑/↓ contra o período anterior; Permutas mostra "N parciais", "N aguardando borderô finalizado", "N com erro"; "N com erro" leva ao histórico filtrado por `status=erro`; semana rotulada "desde sex 18:00"; SISPAG nunca usa a palavra "pago" sem "confirmado"
- [ ] Histórico: filtros (frente, status, período), "carregar mais" com cursor, estado vazio, tempo relativo com absoluto no tooltip, link para a frente só com `<frente>:ver` (id do alvo em texto copiável)
- [ ] Segurança: âncora `#senha`; formulário completo mas desabilitado com "em breve" enquanto `SENHA_PROPRIA_HABILITADA = false`; com a flag ligada no teste e endpoint mockado, mapeamento 204 → sucesso, 400 `POLITICA` → checklist, 422 `SENHA_ATUAL_INVALIDA` → erro no campo (não abre modal de sessão), 429 → "muitas tentativas", 503 → "não foi possível verificar"
- [ ] `MODULOS` exportado de `lib/permissoes.ts` cobre as 10 permissões do catálogo, Frente IV rotulada "Adiantamentos"
- [ ] Os testes falham (módulos ainda não existem)

**Dependencies:** none

---

### Task 8: UI primitives — dropdown-menu, avatar and shared permission labels
**Files to change:**
- `src/frontend/package.json` / `src/frontend/package-lock.json` (`@radix-ui/react-dropdown-menu@^2.1`)
- `src/frontend/components/ui/dropdown-menu.tsx` (novo)
- `src/frontend/components/ui/avatar.tsx` (novo; iniciais, sem Radix)
- `src/frontend/lib/permissoes.ts` (receber `MODULOS`)
- `src/frontend/app/usuarios/EditarAcessoDialog.tsx` (importar `MODULOS` de `lib/permissoes.ts`)

**Acceptance criteria:**
- [ ] Dependência nova só `@radix-ui/react-dropdown-menu`; pins `react-slot 1.1.1` e `react-tabs 1.1.2` inalterados; `npm ls @radix-ui/react-dropdown-menu` sem peer warning de React
- [ ] `dropdown-menu.tsx` segue o padrão dos wrappers existentes (`popover.tsx`, `select.tsx`): tokens do DS, foco visível, `forwardRef`
- [ ] `EditarAcessoDialog` renderiza igual ao antes (testes existentes de `/usuarios` passam sem alteração)
- [ ] Testes de avatar, dropdown e `lib/permissoes` da Task 7 passam

**Dependencies:** Task 7

---

### Task 9: UserMenu becomes the avatar dropdown in the AppShell header
**Files to change:**
- `src/frontend/components/auth/UserMenu.tsx`
- `src/frontend/components/AppShell.tsx` (só se o encaixe no header exigir)
- `src/frontend/__tests__/AppShell.test.tsx` (ajustar se o markup do header mudar)

**Acceptance criteria:**
- [ ] Papel vem de `usePermissoes().papel` (sem chamada nova); sem papel (carregando/falhou) mostra só o username
- [ ] Funciona em mobile (avatar visível abaixo de `sm`, menu alinhado à direita, alvo de toque ≥ 40px) e em desktop
- [ ] "Sair" reutiliza o fluxo de logout atual sem mudança de comportamento
- [ ] Testes de UserMenu e AppShell passam

**Dependencies:** Task 8

---

### Task 10: /perfil page shell, API client, Identidade and Permissões sections
**Files to change:**
- `src/frontend/lib/api/perfil.ts` (novo; `getPerfil`, `getAtividade`, `getHistorico` sobre o `apiFetch` de `lib/api.ts`)
- `src/frontend/app/perfil/page.tsx` (novo)
- `src/frontend/app/perfil/IdentidadeSection.tsx` (novo)
- `src/frontend/app/perfil/PermissoesSection.tsx` (novo)
- `src/frontend/components/nav/app-nav.tsx` (só se o DS exigir entrada de nav; default: acesso só pelo menu)

**Acceptance criteria:**
- [ ] `PageHeader` + cards empilhados na ordem Identidade, Permissões, Minha atividade, Histórico, Segurança (`id="senha"`)
- [ ] Identidade: username, e-mail ("não cadastrado" quando nulo), papel, "membro desde", vínculo Conexos; sem vínculo → aviso no padrão de `ConexosStatusBanner` ("suas execuções saem no ERP como robô CLONEX"); nenhum controle de edição; link para `/usuarios` só com `usuarios:gerenciar`
- [ ] Permissões: agrupadas por `MODULOS`, cada uma com a origem (papel / concedida por X em data / revogada por X / implicada por executar); `falhou` → "não foi possível verificar"
- [ ] 401 segue o fluxo existente do `apiFetch` (modal de sessão); 503 nunca desloga
- [ ] Testes correspondentes da Task 7 passam

**Dependencies:** Task 6, Task 9

---

### Task 11: Minha atividade section (KPIs per frente with comparison)
**Files to change:**
- `src/frontend/app/perfil/AtividadeSection.tsx` (novo)
- `src/frontend/app/perfil/periodo.ts` (novo; chave `localStorage`, rótulos dos períodos)

**Acceptance criteria:**
- [ ] Seletor Hoje / Esta semana ("desde sex 18:00") / Este mês / Personalizado; escolha persistida com try/catch (padrão de `app/metricas/page.tsx`)
- [ ] `KPIGrid` + `SimpleKPI` por frente, gate `<frente>:ver`; R$ formatado em BRL; ↑/↓ com tokens de cor do DS e texto acessível (não só cor)
- [ ] Permutas: principal = concluídas (settled com borderô finalizado), R$ baixado, footers "N parciais", "N aguardando borderô finalizado", "N com erro"
- [ ] SISPAG: lotes finalizados, remessas geradas, retornos conciliados, R$ remessado / agendado / pago confirmado, "N com erro"; vocabulário I4
- [ ] Adiantamentos (Frente IV): concluídas, R$, "N com erro"
- [ ] "N com erro" rola até o Histórico com `status=erro` e a frente aplicados
- [ ] Testes correspondentes da Task 7 passam

**Dependencies:** Task 10

---

### Task 12: Histórico section (filters, cursor pagination, responsive)
**Files to change:**
- `src/frontend/app/perfil/HistoricoSection.tsx` (novo)

**Acceptance criteria:**
- [ ] Filtros frente / status / período; mudar filtro reinicia o cursor
- [ ] "Carregar mais" usa `proximoCursor` opaco (o front nunca decodifica); sem `proximoCursor` o botão some
- [ ] Tabela em `md+`, cards abaixo de `md`; status como `Badge` (badge extra "parcial" quando `detalhe.parcial`); "assinado no ERP como X" quando `detalhe.conexosUsername` difere do vínculo
- [ ] Tempo relativo com data/hora absoluta (SP) no tooltip; `EmptyState` quando vazio; erro independente com tentar de novo
- [ ] Testes correspondentes da Task 7 passam

**Dependencies:** Task 10

---

### Task 13: Segurança section built and disabled behind a flag
**Files to change:**
- `src/frontend/app/perfil/SegurancaSection.tsx` (novo)
- `src/frontend/lib/perfil/senha.ts` (novo; `SENHA_PROPRIA_HABILITADA = false`, mapeamento de erros 204/400/422/429/503)

**Acceptance criteria:**
- [ ] Com a flag desligada: campos e botão desabilitados, selo "em breve", **nenhuma** chamada de rede (teste assegura que `fetch` não é chamado)
- [ ] Checklist de política renderizado; mapeamento de erros testado contra endpoint mockado com a flag ligada no teste
- [ ] 422 `SENHA_ATUAL_INVALIDA` nunca cai no tratamento de 401 do `apiFetch`
- [ ] Teste da Task 7 passa; `npm run typecheck`, `npm run lint`, `npm test` em `src/frontend` passam

**Dependencies:** Task 10

---

### Task 14: Update ontology index and coverage to implemented
**Files to change:**
- `ontology/_index.json` (`AtividadeUsuario.impl_files` com os caminhos reais, sem "(a criar)")
- `ontology/_coverage.json` (`AtividadeUsuario` → implemented)
- `ontology/entities/atividade-usuario.md` (`implementation_status: implemented`, `related_files` reais)

**Acceptance criteria:**
- [ ] Todo arquivo citado existe no diff final
- [ ] `implementation_status` coerente entre os três arquivos

**Dependencies:** Task 6, Task 13

---

### Task 15: ObservabilityAdvisor review of the three new read handlers
**Files to change:**
- `src/backend/routes/me.ts` (só se a revisão pedir)
- `src/backend/domain/service/perfil/PerfilService.ts` (só se a revisão pedir)

**Acceptance criteria:**
- [ ] ObservabilityAdvisor chamado para `GET /me`, `GET /me/atividade`, `GET /me/historico` (handlers novos; não há job nem Lambda)
- [ ] Logs, se houver, em português, sem e-mail nem dados de permissão de outro usuário; sem double-log de erro já tratado pelo `asyncHandler`

**Dependencies:** Task 6

---

### Task 16: Read-only equivalence script against the live ledger (substitute ground truth)
**Files to change:**
- `src/backend/jobs/validate-perfil-usuario-v1.ts` (novo)
- `src/backend/jobs/validatePerfilUsuarioIsolation.test.ts` (novo; assegura no fonte que o script não importa `ConexosClient`, `ConexosSessionResolver` nem `bootstrapAppContainer`)

**Acceptance criteria:**
- [ ] Conecta com `pg.Pool` direto a partir de `databaseConnectionString`, roda tudo em `BEGIN TRANSACTION READ ONLY` (padrão `probe-impacto-recebimentos-kpis.ts`) e termina em `ROLLBACK`; **não** toca Conexos nem a tabela de sessão do robô (memória: script local com banco de prod contamina a sessão `columbia-default`)
- [ ] Para cada semana fechada da série (`metricas.serie_inicio()` até a última sexta 18:00) e cada `executado_por` distinto: roda as consultas de agregados do `AtividadeUsuarioRepository` e verifica, com **tolerância zero**, Σ usuários = linha de `metricas.metricas_ciclo()` da semana para Permutas concluídas (do rótulo `%s de %s`) e `permutas_valor_baixado`, Recebimentos concluídas/valor e SISPAG `valor_aceito` (= Σ R$ agendado)
- [ ] Para 2–3 usuários reais, compara os KPIs do repositório com uma consulta independente escrita à parte no script (contagem por status, `SUM`), tolerância zero
- [ ] Saída: tabela por semana/frente com OK/DIVERGE; exit code ≠ 0 em divergência; resultado colado no PR
- [ ] Executado uma vez contra produção (read-only) antes do Regis-Review; divergência = P0 e volta ao loop

**Dependencies:** Task 4, Task 5

---

### Task 17: Version bump against the real main
**Files to change:**
- `src/backend/package.json`
- `src/frontend/package.json`
- `CHANGELOG.md`

**Acceptance criteria:**
- [ ] Versão real da `origin/main` reconferida após o rebase (sessões paralelas colidem); bump **minor** (feat) em FE e BE em lockstep: hoje `0.48.0` → `0.49.0`, salvo se a main já tiver avançado
- [ ] `scripts/bump-version.ps1` não roda nesta máquina (sem pwsh): regra de semver aplicada à mão nos dois `package.json` (+ lockfiles se carregarem a versão)
- [ ] Entrada no `CHANGELOG.md`; commit `chore(release): vX.Y.Z`
- [ ] Número da migration (0072) e da ADR (0058) reconferidos contra a main no mesmo momento

**Dependencies:** all previous tasks

## Definition of Done

All tasks complete AND:
- [ ] `npm run typecheck` ✅ (src/backend e src/frontend)
- [ ] `npm run lint` ✅ (src/backend e src/frontend)
- [ ] `npm test` ✅ (src/backend e src/frontend)
- [ ] PatternGuardian gate ✅ (conferir P0 contra a main: ele revisa o arquivo inteiro)
- [ ] entity_changed: ontology diff in `ontology/` present ✅
- [ ] frontend touched: DesignSystemReviewer gate ✅
- [ ] new handlers: ObservabilityAdvisor review ✅ (Task 15)
- [ ] SpecVerifier (cego, tasks.md + diff) ✅
- [ ] Ground truth `SEM_GROUND_TRUTH`: equivalência read-only da Task 16 sem divergência ✅
- [ ] Regis-Review gate (model=sonnet) com P0 remediados ✅
- [ ] delta has feat in `src/`: app version bumped (FE+BE lockstep) at Ship + `CHANGELOG.md` updated ✅
