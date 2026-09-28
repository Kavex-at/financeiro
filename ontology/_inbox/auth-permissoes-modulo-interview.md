# OfficeHours — Auth: permissões por módulo lidas do banco (passo 2 de 3)

> Modo: `new`. Conduzida em 2026-09-28. Slug: `auth-permissoes-modulo`.
> Decisões do dono do ciclo recebidas via orquestrador (não houve conversa direta nesta rodada).
> `entity_changed = false` (justificativa no fim). Continua a ADR-0051 (passo 1, PR #92, v0.43.0).

## Intent

Trocar o `requireRole('admin')` binário (todo mundo é admin, então ele não recorta nada) por
permissões grossas por módulo, em dois níveis, guardadas no banco e consultadas pelo backend a cada
requisição. O token não carrega permissão nenhuma, para que o passo 3 (Supabase Auth, tokens novos)
não precise reescrever a autorização. No dia do deploy nada muda para ninguém: todo usuário recebe
o papel "Administrador", com todas as permissões. Os papéis reais da Columbia vêm depois, e essa
mudança tem de ser só de dados.

## Estado atual verificado no código

| Ponto | Onde | Observação |
|---|---|---|
| Papel | `migrations/0007_app_user.sql:8` | `role TEXT NOT NULL DEFAULT 'admin'`, texto livre, sem CHECK |
| Papéis no código | `domain/service/auth/UserAdminService.ts:16` | `USER_ROLES = ['admin','operador']`; usuário novo pela UI nasce **`operador`** por default (`:43`, e `NovoUsuarioDialog.tsx:40`) |
| Produção (2026-09-28) | contagem do passo 1 | 15 usuários, 14 ativos, **todos `admin`**; nenhum `operador` |
| Token | `AuthService.signToken` | `sub = username`, claim `role`; sem `email`, sem `id` do `app_user` |
| Middleware | `http/auth.ts` `buildAuthMiddleware` | só verifica assinatura, `aud`, `iss`; **não toca o banco**. Usuário desativado segue com token válido por até 12h |
| Guard | `http/auth.ts` `requireRole(...allowed)` | 401 sem `req.user`; 403 `Forbidden: insufficient role` (inglês) |
| Allow-list Operação | `http/operacaoAcesso.ts` + env `OPERACAO_USUARIOS` (CSV de `username`) | fail-open (lista vazia = todo admin entra); responde **404**, não 403, por obscuridade deliberada (ADR-0042) |
| `/me/permissoes` | `routes/me.ts:35` | devolve só `{ operacao: boolean }` |
| Última guarda de admin (R11) | `UserRepository.deactivateGuarded` | trava `WHERE role = 'admin' AND ativo` `FOR UPDATE`; ninguém desativa a si mesmo nem o último admin ativo |
| Flags | `http/sispagGate.ts`, `http/recebimentosGate.ts` (403 quando desligado); front `lib/features.ts` `isSispagEnabled()` (`NEXT_PUBLIC_SISPAG_ENABLED`) | Recebimentos não tem flag no front, por decisão (ADR-0028) |
| Escopo por filial | `http/filialAuthz.ts`, lido em `routes/recebimentos.ts:51` | lê claim `filiais` do **token**; ausente = libera tudo |
| Front | `lib/auth/AuthProvider.tsx:237` `useIsAdmin()` = `role` do token; `components/nav/app-nav.tsx`, `components/home/AdminHomeCard.tsx`, `app/usuarios/page.tsx`; `OperacaoHomeCard` e nav via `fetchPermissoes()` | nenhum botão de ação é escondido por papel hoje |
| Deploy | `render.yaml`: `plan: starter`, sem `numInstances` | **uma instância** web; ~58 jobs rodam fora do HTTP (GH Actions / manual) e não passam por guard |
| Consumidor externo | `kavex-report-ciclo` faz login como um usuário comum (`FINANCEIRO_API_USUARIO`) e lê `/metricas/ciclo` | precisa manter `metricas:ver` (ver Q6) |

## Axis 1 — Entity

Nenhuma entidade do domínio financeiro. Tudo é infraestrutura de acesso, na mesma prateleira do
`app_user` (passo 1) e do config doctor (`painel-operacao`). Modelo proposto:

- **Catálogo de permissões: fixo no código** (decisão do dono do ciclo), sem tabela. Nove valores:
  `permutas:ver`, `permutas:executar`, `sispag:ver`, `sispag:executar`, `recebimentos:ver`,
  `recebimentos:executar`, `operacao:ver`, `metricas:ver`, `usuarios:gerenciar`. Constantes
  tipadas, nunca strings cruas espalhadas.
- **`app_role`**: `id`, `nome` (único, sem distinção de caixa), `descricao`, `created_at`. Um papel
  é um pacote nomeado de permissões.
- **`app_role_permission`**: `(role_id, permission)`, PK composta. O valor de `permission` é
  validado contra o catálogo na escrita (Zod) e com `CHECK` no banco (ver R4).
- **`app_user.role_id`**: FK para `app_role`, `NOT NULL` depois do backfill. **Um papel por
  usuário** (Q5).
- **`user_permission`**: exceções por usuário, chaveadas por `app_user.id`:
  `(user_id, permission, efeito, concedido_por, concedido_em)`, PK `(user_id, permission)`.
  `efeito` depende de Q2 (`conceder` apenas, ou `conceder | revogar`).
- **Seed na migration:** papel `Administrador` com as nove permissões; `role_id` de todo usuário
  existente = Administrador (ver Q1 para a exceção `operacao:ver` e Q3 para `operador`).
- **Chave de lookup:** o armazenamento é por `app_user.id`, mas o token só traz `sub = username`.
  O lookup resolve `sub → app_user` pelo índice único em `lower(username)` (criado no passo 1) e
  lê permissões pelo `id`. No passo 3 muda só a primeira metade (UUID do Supabase → `app_user`); as
  tabelas de permissão não mudam. É por isso que chavear por `id`, e não por `username`, é o certo.

**Imutável / histórico:** o catálogo muda só por código. Papéis, pacotes e exceções são mutáveis
por quem tem `usuarios:gerenciar` (exceções e atribuição agora; pacotes via migration, Q4). A trilha
de quem mudou o quê fica em Q7.

## Axis 2 — Action

| Ação | Pré-condição | Pós-condição | Idempotente? |
|---|---|---|---|
| `resolverAcesso` (middleware, toda rota autenticada) | token válido (`buildAuthMiddleware` já passou) | `req.acesso = { userId, ativo, permissoes: Set }` a partir do cache ou do banco. `sub` sem `app_user` correspondente ou `ativo = false` → **401** (o front já trata 401 como sessão encerrada) | sim, só leitura |
| `exigirPermissao(p)` (guard por rota) | `resolverAcesso` rodou | passa se `p ∈ efetivas`; senão 403 com mensagem em português (Q9). Exceção: `operacao:ver` ausente responde **404**, preservando ADR-0042 | sim |
| `consultarMinhasPermissoes` (`GET /me/permissoes`) | autenticado | `{ permissoes: string[], papel: { id, nome }, operacao: boolean }`. `operacao` fica por compatibilidade na janela entre deploys (backend sobe antes do front) | sim |
| `atribuirPapel` (`PATCH /usuarios/:id/papel`) | chamador tem `usuarios:gerenciar`; papel existe; não remove o último detentor ativo de `usuarios:gerenciar` (R9) | `role_id` gravado; cache do alvo invalidado; evento de auditoria | sim (mesmo papel = no-op) |
| `definirExcecoes` (`PUT /usuarios/:id/permissoes`) | idem; permissões do catálogo; guarda R9 | conjunto de exceções do usuário substituído; cache invalidado; evento de auditoria | sim (PUT do mesmo conjunto) |
| `listarPapeis` (`GET /usuarios/papeis` ou dentro de `/usuarios/meta`) | `usuarios:gerenciar` | papéis com seus pacotes, para o seletor da UI | sim |
| `desativar` (existente, `PATCH /usuarios/:id/ativo`) | R11 do passo 1, **reescrita** sobre permissões efetivas (R9) | além do que já faz, invalida o cache do alvo: a próxima requisição dele dá 401 | sim |
| `criarUsuario` (existente) | papel escolhido explicitamente na UI (Q3) | `role_id` gravado; `role` texto não é mais a fonte de autorização | não (409 no segundo) |

Nenhuma ação escreve no Conexos, Nexxera ou GED. Nenhuma muda `executado_por`/`criado_por`.

## Axis 3 — Invariant

- **I1 — Permissão nunca vem do token.** Nem hoje (JWT próprio) nem no passo 3. O token só
  identifica; o banco autoriza. O claim `role` pode continuar sendo emitido na janela de
  compatibilidade, mas **nenhum guard do servidor o lê** depois desta feature.
- **I2 — O gate real é o servidor.** Esconder no front é ergonomia (regra já escrita em
  `app-nav.tsx`). Front desatualizado esconde ou mostra um botão; não abre porta.
- **I3 — Usuário inativo não passa de requisição nenhuma**, no máximo até o fim da janela de cache
  (R7). Fecha a lacuna de 12h registrada na ADR-0051.
- **I4 — Sempre existe ao menos um usuário ativo com `usuarios:gerenciar` efetivo.** Substitui o
  "último admin ativo" da R11, que olhava `role = 'admin'`.
- **I5 — Identidade de auditoria inalterada** (I1 da ADR-0051): `sub = username` segue sendo o que
  vai para `executado_por`, `triggeredBy`, vínculo Conexos. Esta feature não toca nenhum desses
  sítios.
- **I6 — Deploy sem mudança de comportamento**, com a ressalva de Q1 (Operação).
- **I7 — `executar` implica `ver`** no mesmo módulo (Q8), calculado em um lugar só.
- **I8 — Flags de frente são ortogonais e vêm antes.** `sispagGate`/`recebimentosGate` continuam
  respondendo 403 "indisponível" antes de qualquer checagem de permissão. Permissão não liga frente
  desligada; flag não concede permissão.
- **I9 — Human-in-the-loop não muda.** As ações que exigem julgamento (finalizar lote, baixa,
  borderô) continuam exigindo um humano; só muda **qual** humano pode.

**Raio de impacto se errar:** I4 errado tranca a gestão de usuários (só SQL direto resolve). I1
errado reintroduz o acoplamento que o passo 3 vai quebrar. Um guard de `executar` posto numa rota de
leitura que a tela chama no load (ex.: `/permutas/status`) deixa usuários só-leitura com a tela
quebrada; o inverso (leitura sensível aberta a `ver`) é o risco de LGPD já apontado nos comentários
de `/sispag/contas-pagadoras` e `/remessa/arquivo`. Por isso a tabela abaixo é por rota.

## Axis 4 — Integration

- **Conexos / Nexxera / GED / SharePoint:** nenhum contrato muda. `conexosIdentity` continua
  chaveado por `sub`.
- **Postgres (Supabase):** migration nova (número provisório `0066`; reconferir contra a `main` no
  rebase, ver `versao-colide-entre-sessoes-paralelas`). Arquivo `.sql` em `migrations/`, coberto
  pela cópia do `npm run build` (gotcha do `BootMigrator`). Uma consulta extra por requisição
  quando o cache está frio.
- **Cache:** em memória, no processo web. Uma instância no Render (`plan: starter`), então invalidar
  no próprio processo quando um gestor muda acesso resolve o caso normal. TTL curto como rede de
  segurança para SQL manual e para a sobreposição de instâncias durante o deploy (R7).
- **Jobs:** o serviço de acesso **não** entra no `bootstrapAppContainer` com efeito de boot (gotcha
  dos ~58 jobs). Resolve-se sob demanda no middleware.
- **Env:** `OPERACAO_USUARIOS` deixa de ser lida pela autorização (Q1). Retirar do `ConfigDoctor`
  (`configManifest.ts:112`), `.env.example` e `DEPLOY.md` no mesmo PR, ou marcar como obsoleta.
- **Tenant:** um só (Columbia). Sem variação. Sem SSM (não há Terraform).
- **Ordem de deploy:** backend antes do frontend. `/me/permissoes` mantém a chave `operacao`; o
  token mantém o claim `role` até o front novo estar no ar.

## Mapeamento por rota (proposta, equivalente ao comportamento de hoje)

Convenção: "hoje" = `aberta` (qualquer autenticado) ou `admin` (`requireRole('admin')`).
**JC** = julgamento, listado em Q10. Todas as rotas abaixo exigem, antes, `resolverAcesso`
(usuário existe e está ativo).

### `/permutas` (27 rotas)

| Método | Rota | Hoje | Proposta | Nota |
|---|---|---|---|---|
| POST | `/eleicao` | admin | `permutas:executar` | **JC-1**: recalcula candidatas; estado local, sem escrita no ERP |
| POST | `/ingestao` | admin | `permutas:executar` | **JC-1**: puxa do ERP para o cache local; também disparado após editar cliente-filtro |
| GET | `/runs` | aberta | `permutas:ver` | |
| GET | `/cliente-filtro` | aberta | `permutas:ver` | |
| POST | `/cliente-filtro` | admin | `permutas:executar` | |
| DELETE | `/cliente-filtro/:pesCod` | admin | `permutas:executar` | |
| GET | `/importadores` | aberta | `permutas:ver` | |
| GET | `/invoices/buscar` | aberta | `permutas:ver` | |
| POST | `/adiantamentos/:docCod/alocacoes` | admin | `permutas:executar` | |
| DELETE | `/adiantamentos/:docCod/alocacoes/:invoiceDocCod` | admin | `permutas:executar` | |
| POST | `/adiantamentos/:docCod/excecao-manual` | admin | `permutas:executar` | |
| DELETE | `/adiantamentos/:docCod/excecao-manual` | admin | `permutas:executar` | |
| GET | `/gestao` | aberta | `permutas:ver` | |
| GET | `/relatorios/:tipo` | aberta | `permutas:ver` | export .xlsx do `/gestao` |
| POST | `/adiantamentos/:docCod/processar` | admin | `permutas:executar` | marca estado do analista |
| POST | `/adiantamentos/:docCod/reconciliar` | admin | `permutas:executar` | escreve no `fin010` |
| POST | `/adiantamentos/:docCod/gerar-numerario` | admin | `permutas:executar` | escreve no ERP |
| POST | `/reconciliar-lote` | admin | `permutas:executar` | escreve no `fin010` |
| GET | `/borderos` | **admin** | `permutas:ver` | **JC-2**: `?live=true` faz refresh ao vivo no ERP (leitura) |
| GET | `/borderos/:borCod/baixas` | **admin** | `permutas:ver` | **JC-2** |
| POST | `/borderos/:borCod/finalizar` | admin | `permutas:executar` | |
| POST | `/borderos/:borCod/cancelar` | admin | `permutas:executar` | |
| POST | `/borderos/:borCod/estornar` | admin | `permutas:executar` | |
| DELETE | `/borderos/:borCod` | admin | `permutas:executar` | |
| DELETE | `/borderos/:borCod/baixas/:invoiceDocCod` | admin | `permutas:executar` | |
| GET | `/adiantamentos/:docCod/execucoes` | aberta | `permutas:ver` | |
| GET | `/status` | **admin** | `permutas:ver` | **JC-2**: a tela principal chama no load para os badges; com `executar` o usuário só-leitura teria tela quebrada |

### `/sispag` (atrás do `sispagGate`; 26 rotas efetivas)

| Método | Rota | Hoje | Proposta | Nota |
|---|---|---|---|---|
| GET | `/painel` | aberta | `sispag:ver` | |
| GET | `/retornos` | aberta | `sispag:ver` | |
| GET | `/lotes/:id/linhas-digitaveis` | aberta | `sispag:ver` | |
| GET | `/lotes/:id/modalidades-disponiveis` | aberta | `sispag:ver` | |
| GET | `/lotes` | aberta | `sispag:ver` | |
| GET | `/lotes/:id` | aberta | `sispag:ver` | |
| POST | `/lotes` | admin | `sispag:executar` | |
| POST | `/lotes/:id/itens` | admin | `sispag:executar` | |
| DELETE | `/lotes/:id/itens/:filCod/:docCod/:titCod` | admin | `sispag:executar` | |
| POST | `/titulos/:filCod/:docCod/:titCod/retirar-do-lote` | admin | `sispag:executar` | |
| POST | `/lotes/:id/finalizar` | admin | `sispag:executar` | |
| POST | `/lotes/:id/reabrir` | admin | `sispag:executar` | |
| POST | `/lotes/:id/cancelar` | admin | `sispag:executar` | |
| POST | `/lotes/:id/retorno` | admin | `sispag:executar` | simulação (só dev local no front) |
| POST | `/lotes/:id/itens/:filCod/:docCod/:titCod/modalidade` | admin | `sispag:executar` | |
| POST | `/lotes/:id/conta` | admin | `sispag:executar` | |
| POST | `/ingestao` | admin | `sispag:executar` | **JC-1** |
| POST | `/lotes/formar` | admin | `sispag:executar` | |
| GET | `/boletos-dda` | aberta | `sispag:ver` | |
| POST | `/boletos-dda/sincronizar` | admin | `sispag:executar` | **JC-1** |
| GET | `/ingestao/runs` | aberta | `sispag:ver` | |
| GET | `/contas-pagadoras` | **admin** | `sispag:executar` | **JC-3**: dado bancário da empresa; só usada ao escolher conta do lote |
| GET | `/lotes/:id/remessa/janela` | aberta | `sispag:ver` | |
| POST | `/lotes/:id/remessa` | admin | `sispag:executar` | gera o `.REM` |
| GET | `/lotes/:id/remessa/arquivo` | **admin** | `sispag:executar` | **JC-3**: CNAB com banco/agência/conta de cada fornecedor (LGPD, LC 105) |
| POST | `/retornos/conciliar` | admin | `sispag:executar` | |
| GET | `/execucoes` | **admin** | `sispag:executar` | **JC-4**: triagem de órfãos; sem chamador no front |

### `/recebimentos` (atrás do `recebimentosGate`; 15 rotas)

| Método | Rota | Hoje | Proposta | Nota |
|---|---|---|---|---|
| GET | `/painel` | aberta | `recebimentos:ver` | |
| GET | `/painel/enriquecimento` | aberta | `recebimentos:ver` | |
| POST | `/pipeline/run` | admin | `recebimentos:executar` | **JC-1** |
| GET | `/clientes` | aberta | `recebimentos:ver` | |
| GET | `/transacoes/:txnId/processos` | aberta | `recebimentos:ver` | |
| GET | `/processos/:priCod/sns` | aberta | `recebimentos:ver` | |
| POST | `/transacoes/:txnId/solicitacao-numerario` | admin | `recebimentos:executar` | escreve no ERP; mantém `filialAuthz` |
| GET | `/execucoes` | **admin** | `recebimentos:executar` | **JC-4** |
| POST | `/ingestao` | admin | `recebimentos:executar` | **JC-1** |
| GET | `/ingestao/runs` | aberta | `recebimentos:ver` | |
| GET | `/contas` | aberta | `recebimentos:ver` | **JC-3**: contas `fin133`; assimétrico com `/sispag/contas-pagadoras` |
| POST | `/ingestao/upload/preview` | admin | `recebimentos:executar` | dry-run, mas é o 1º passo do upload |
| POST | `/ingestao/upload` | admin | `recebimentos:executar` | |
| POST | `/transacoes/:txnId/arquivar` | admin | `recebimentos:executar` | |
| POST | `/transacoes/:txnId/desarquivar` | admin | `recebimentos:executar` | |

### `/usuarios` (7 rotas + as novas)

Todas: hoje `router.use(requireRole('admin'))` → **`usuarios:gerenciar`** no `router.use`.
`GET /meta`, `GET /`, `POST /`, `PATCH /:id/email`, `PATCH /:id/ativo`, `POST /:id/reset-senha`,
`PATCH /:id/vinculo`, e as novas `PATCH /:id/papel`, `PUT /:id/permissoes`, `GET /papeis`.

### `/operacao` (2 rotas)

| Método | Rota | Hoje | Proposta | Nota |
|---|---|---|---|---|
| GET | `/` | admin + allow-list (404) | `operacao:ver` (404 quando ausente) | |
| POST | `/alertas/:id/reconhecer` | admin + allow-list (404) | `operacao:ver` | **JC-5**: não há `operacao:executar`; reconhecer alerta fica com quem vê |

### `/metricas`, `/me`, `/conexos`

| Método | Rota | Hoje | Proposta | Nota |
|---|---|---|---|---|
| GET | `/metricas/ciclo` | aberta | `metricas:ver` | conta do `kavex-report-ciclo` precisa dela (Q6) |
| GET | `/me/conexos-status` | aberta | autenticado + ativo | sem permissão: é sobre o próprio usuário |
| GET | `/me/permissoes` | aberta | autenticado + ativo | é a fonte do front |
| GET | `/conexos/filiais` | aberta | autenticado + ativo | **JC-6**: seletor de filial usado pelas três frentes; exigir uma permissão de módulo não faz sentido |

### Rotas públicas (sem mudança)

`/health`, `/health/*`, `/auth/login`, `/auth/transicao`.

## Mapeamento no frontend

Regra do design system (já citada em `app-nav.tsx`): **permissão ausente esconde, nunca
desabilita.** A fonte é `/me/permissoes`, carregada uma vez por sessão (e após o login), num hook
único (`usePermissoes`) que substitui `useIsAdmin()`.

| Elemento | Hoje | Proposta |
|---|---|---|
| Nav "Permutas" + filhos "Borderôs", "Clientes p/ permuta" | sempre visível | `permutas:ver` |
| Nav "SISPAG" | `isSispagEnabled()` | `isSispagEnabled() && sispag:ver` |
| Nav "Adiantamentos" (`/recebimentos`) | sempre visível | `recebimentos:ver` |
| Nav "Operação" | `fetchPermissoes().operacao` | `operacao:ver` |
| Nav "Métricas" | sempre visível | `metricas:ver` |
| Nav "Usuários" | `useIsAdmin()` | `usuarios:gerenciar` |
| Home: card Permutas / SISPAG / Adiantamentos | sempre (SISPAG esmaecido com flag off) | escondido sem o `:ver` correspondente; o esmaecimento do SISPAG por flag fica como está (fora de escopo) |
| Home: `OperacaoHomeCard` / `AdminHomeCard` | `/me/permissoes` / `useIsAdmin()` | `operacao:ver` / `usuarios:gerenciar` |
| Páginas `/permutas`, `/permutas/borderos`, `/permutas/clientes-filtro`, `/sispag`, `/recebimentos`, `/metricas`, `/usuarios` | sem guard (salvo `/usuarios` por `isAdmin` e `/sispag` por flag) | guard de página: sem o `:ver`, estado vazio "Você não tem acesso a esta área." com link para a home; sem redirecionamento silencioso |
| `/operacao` | trata 404 do backend | igual (404 = "não existe") |
| Botões de ação em Permutas (ingestão, eleição, alocar, exceção manual, processar, reconciliar, gerar numerário, reconciliar lote, finalizar/cancelar/estornar/excluir borderô, remover baixa, adicionar/remover cliente-filtro) | sempre visíveis | `permutas:executar` |
| Botões em SISPAG (novo lote, formar, incluir/remover item, retirar do lote, modalidade, conta, finalizar/reabrir/cancelar, gerar remessa, baixar `.REM`, conciliar retorno, ingestão, sincronizar DDA) | sempre visíveis | `sispag:executar`. O seletor de conta pagadora não chama `/contas-pagadoras` para quem só vê (JC-3) |
| Botões em Adiantamentos (rodar pipeline, ingestão, upload de extrato, solicitação de numerário / alocar processos, arquivar/desarquivar) | sempre visíveis | `recebimentos:executar` |
| Botão "Reconhecer" alerta em Operação | visível a quem vê | `operacao:ver` |
| `/usuarios`: seletor "Papel" no `NovoUsuarioDialog` (hoje `admin`/`operador` fixos) | lista fixa | papéis do banco (`GET /usuarios/papeis`); nova ação "Editar acesso" (papel + exceções) na linha do usuário |

## Decisões já tomadas (dono do ciclo)

- Permissões por página/feature, grossas, dois níveis: as nove do catálogo acima. "ver/executar é o
  certo."
- **Opção B:** permissões no banco, chaveadas por `app_user.id`, consultadas pelo backend a cada
  requisição, com cache curto em memória invalidado quando um gestor muda acesso. **Nunca no
  token.** O front lê de `/me/permissoes`.
- Papéis são pacotes nomeados; `user_permission` guarda exceções por usuário. Catálogo fixo no
  código, sem tabela.
- Dia um: papel "Administrador" com todas as permissões, atribuído a todos. Papéis concretos da
  Columbia (provável: poucos, algo como Analista / Consulta / Admin, porque quase todos usam as três
  frentes) vêm depois, de conversa com a Columbia, e essa mudança tem de ser só de dados.
- O lookup por requisição também checa `ativo` (fecha a lacuna das 12h).
- O allow-list `OPERACAO_USUARIOS` vira `operacao:ver`.
- Todos migram para e-mail `@columbiabr.com` (passo 1); a conta compartilhada `admin` será
  aposentada.

## Extracted rules

- R1: A autorização de toda rota autenticada vem de `permissoesEfetivas(userId)`, calculada no
  servidor a partir do banco. `req.user.role` não é lido por guard nenhum.
- R2: `permissoesEfetivas = fecho(pacote(papel) ∪ concedidas) − revogadas`, onde `fecho` adiciona
  `X:ver` para todo `X:executar`, e revogar `X:ver` remove também `X:executar` (se Q2 = conceder e
  revogar; se só conceder, a subtração some).
- R3: Usuário inexistente ou `ativo = false` → 401 em qualquer rota autenticada.
- R4: Valores de permissão fora do catálogo são recusados na escrita (Zod + `CHECK` na coluna). Se
  um valor antigo sobrar no banco depois de uma permissão sair do código, o cálculo o ignora e loga
  aviso; não derruba a requisição.
- R5: Falta de permissão → 403 com mensagem em português; exceção `operacao:ver` → 404 (ADR-0042).
- R6: Flags (`sispagGate`, `recebimentosGate`) rodam antes do guard de permissão e não mudam.
- R7: Cache por `userId` em memória, invalidado no próprio processo em toda escrita de acesso
  (papel, exceções, ativo); TTL de 30 s como rede de segurança (Q11). Falha ao ler o banco →
  **fail-closed** (503), nunca "libera por não saber". Única exceção de fail-open que existia
  (`OPERACAO_USUARIOS` vazia) deixa de existir.
- R8: Migration: cria `app_role`, `app_role_permission`, `user_permission`, `app_user.role_id`;
  semeia Administrador com as nove; atribui a todos. Aditiva; não apaga `app_user.role`.
- R9 (substitui R11 do passo 1 na parte "último admin"): nenhuma escrita (desativar, trocar papel,
  alterar exceções) pode deixar zero usuários ativos com `usuarios:gerenciar` efetivo; checagem e
  escrita na mesma transação, com as linhas travadas (`FOR UPDATE`), como hoje. "Ninguém desativa a
  si mesmo" permanece.
- R10: `/me/permissoes` devolve `{ permissoes, papel, operacao }`; `operacao` é compatibilidade e
  sai num tweak posterior.
- R11: O front esconde (nunca desabilita) nav, cards, páginas e botões conforme R1–R2; o servidor é
  o gate.
- R12: Toda mudança de acesso gera trilha (quem, quando, alvo, antes → depois) (Q7).
- R13: Mensagens ao operador em português (ADR-0042 de convenção).

## entity_changed: false

**Justificativa:** papéis e permissões são infraestrutura de acesso, como `app_user` no passo 1.
Nenhum arquivo de `ontology/entities/`, ação de domínio, máquina de estado ou regra de negócio
financeira muda, e a identidade de auditoria (`executado_por`) fica intocada (I5). O que muda é
decisão de arquitetura: **precisa de ADR** (número provisório 0053) que **emenda a ADR-0011**
(RBAC por `requireRole`, "toda mutação usa `requireRole('admin')`" deixa de valer) e a **ADR-0042**
(allow-list por env vira permissão `operacao:ver`), e continua a ADR-0051 (fecha a lacuna das 12h).
O OntologyCurator pode escrevê-la em paralelo, sem diff de entidade.

### Ontology diff needed: no (ADR sim)
### Reason: new property (infra de acesso, fora da ontologia de domínio) + amend de ADR-0011/0042

## Handoff

→ **TaskScoper** — perguntas respondidas em 2026-09-28 (ver "Respostas").
para a ADR.

## Open questions

### P0 (bloqueante)

- **Q1 — Como o `OPERACAO_USUARIOS` de produção vira dado sem mudar quem vê o Painel de
  Operação?** A decisão "Administrador com todas as permissões, para todos" e a decisão "o
  allow-list vira `operacao:ver`" só são compatíveis se o allow-list estiver **vazio** em produção
  (fail-open: todo admin já vê). Se estiver preenchido, dar `operacao:ver` a todos abre o painel para
  quem hoje recebe 404. A migration SQL não lê env, e escrever `username` de produção dentro dela é
  valor de tenant no código. Preciso de: **(i)** o valor atual de `OPERACAO_USUARIOS` no Render, e
  **(ii)** qual caminho seguir se não estiver vazio:
  **(a)** o pacote Administrador fica **sem** `operacao:ver`; quem está no allow-list recebe
  `operacao:ver` como exceção concedida, por um gestor na tela nova logo após o deploy (roteiro no
  `DEPLOY.md`). Janela de minutos em que ninguém vê Operação.
  **(b)** Administrador com tudo, e aceita-se que todos passem a ver Operação (o recorte é
  abandonado).
  **(c)** Administrador com tudo, e quem está fora do allow-list recebe exceção **revogando**
  `operacao:ver` (exige Q2 = conceder e revogar).
  Recomendo **(a)** se a lista tiver poucas pessoas, porque mantém o pacote Administrador limpo e o
  recorte vira exceção visível na tela. Se a lista estiver vazia, a pergunta se resolve sozinha:
  Administrador com tudo, sem exceção.

### P1 (desejável; há default proposto)

- **Q2 — Exceção pode tirar permissão do papel, ou só dar?** Default proposto: **as duas**
  (`efeito = conceder | revogar`, revogar vence). Com poucos papéis grossos e "quase todo mundo usa
  as três frentes", o caso comum tende a ser "Analista, menos executar SISPAG", que só se escreve
  com revogação ou com um papel novo por pessoa. Custo: a tela precisa mostrar o efetivo, não só as
  exceções. Alternativa mais simples: só conceder, e o recorte vira papel.
- **Q3 — Destino de `app_user.role` e de `'operador'`.** Default proposto: `role` fica no banco,
  sem uso para autorização, até o passo 3 (o front antigo ainda lê o claim na janela de deploy), e
  sai lá. `USER_ROLES` e o default `'operador'` saem do código. A migration mapeia `'admin'` →
  Administrador; como produção tem zero `operador`, qualquer outro valor **aborta** a migration com
  mensagem clara (dev/staging resolvem à mão), em vez de semear um segundo papel por especulação.
  Usuário novo pela UI: papel escolhido explicitamente, sem default.
- **Q4 — Gestão de papéis.** Default proposto: nesta feature, a tela `/usuarios` **atribui** papel
  e **edita exceções**; criar/editar papéis (pacotes) é por migration de dados, até existir pedido
  de tela. Satisfaz "mudança só de dados" (uma migration SQL de seed não é código de aplicação).
- **Q5 — Um papel por usuário ou vários?** Default proposto: **um**. Exceções cobrem o resto, e o
  cálculo e a tela ficam triviais.
- **Q6 — Conta do `kavex-report-ciclo`.** Ele faz login como um usuário comum. Se for a conta
  compartilhada `admin`, aposentá-la (passo 1, Q7) quebra o report; e quando os papéis da Columbia
  chegarem, essa conta precisa manter `metricas:ver`. Default proposto: criar um usuário de serviço
  próprio (papel com só `metricas:ver`, via exceções ou papel "Relatório") e trocar a credencial em
  `~/.claude-kavex/settings.json` antes de desativar o `admin`. Confirmar qual conta ele usa hoje.
- **Q7 — Auditoria de mudança de acesso.** Default proposto: tabela append-only
  `app_user_access_event` (`ator`, `alvo_user_id`, `tipo` = papel | excecao | ativo, `antes`,
  `depois` em JSON, `em`) mais uma linha de `LogService` em português. Colunas `*_updated_by` como
  no e-mail não bastam: são vários campos e o histórico importa ("quem tirou o SISPAG da Fulana?").
  Leitura dessa trilha pela tela fica fora de escopo (consulta SQL basta por ora).
- **Q8 — `executar` implica `ver`?** Default: **sim** (quase decidido no enunciado). Consequência na
  UI: marcar "executar" marca "ver"; desmarcar "ver" desmarca "executar".
- **Q9 — Texto do 403.** Default: `{ error: 'Você não tem permissão para esta ação.', permissao:
  'sispag:executar' }`. Expor o código da permissão ajuda o suporte e não revela nada que a tela de
  usuários não mostre. Operação continua 404 sem corpo explicativo.
- **Q10 — Chamadas de julgamento na tabela de rotas** (defaults já aplicados na tabela):
  - **JC-1:** ingestões/eleição/pipeline/sincronizar DDA ficam em `executar` (equivalente a hoje).
    Efeito: quem só vê não tem botão "Atualizar dados" e depende dos crons. Aceitável?
  - **JC-2:** `GET /permutas/borderos`, `/borderos/:borCod/baixas` e `/permutas/status` **descem**
    de admin para `ver`. `/status` precisa (a tela principal o chama no load). `?live=true` em
    `/borderos` passa a ser acionável por quem só vê; é leitura no ERP, mas consome sessão do
    Conexos. Aceitável, ou `live=true` exige `executar`?
  - **JC-3:** `/sispag/contas-pagadoras` e `/sispag/lotes/:id/remessa/arquivo` ficam em
    `sispag:executar` (dado bancário, LGPD). `/recebimentos/contas` fica em `recebimentos:ver`
    (hoje aberta). A assimetria fica registrada; igualar é outro tweak.
  - **JC-4:** `GET /sispag/execucoes` e `GET /recebimentos/execucoes` (triagem de órfãos, sem
    chamador no front) ficam em `<frente>:executar`. Alternativa: `operacao:ver`, já que é
    diagnóstico.
  - **JC-5:** reconhecer alerta = `operacao:ver` (não existe `operacao:executar`).
  - **JC-6:** `/conexos/filiais` e `/me/*` exigem só usuário ativo, sem permissão de módulo.
- **Q11 — TTL do cache.** Uma instância web no Render; invalidação no processo cobre as escritas
  pela tela. Default: **30 s** de TTL, para cobrir SQL manual e a sobreposição de instâncias no
  deploy. Pior caso de um usuário desativado: 30 s, contra as 12 h de hoje.
- **Q12 — Escopo por filial (`filialAuthz`).** Default: **fora de escopo**, intocado. Registro na
  ADR: ele lê o claim `filiais` do **token**, o que contraria o princípio desta feature; quando o
  recorte por filial for feito, vem do banco, como as permissões.
- **Q13 — `DEV_AUTH_BYPASS`.** Com bypass não há `req.user`, e hoje toda rota `admin` já responde
  401 em dev com bypass. Default: manter (bypass continua sem autorização; não inventar um usuário
  fictício com tudo).

## Respostas (2026-09-28)

O dono do ciclo confirmou a tabela de rotas e **todos os defaults** Q2–Q13 e JC-1…JC-6 como
propostos (inclusive JC-2: `GET /permutas/borderos?live=true` fica em `permutas:ver`).

- **Q1 — resolvida por compatibilidade, sem precisar do valor de produção.** O pacote
  Administrador recebe **todas** as permissões, inclusive `operacao:ver`. Nesta feature,
  `/operacao` exige `operacao:ver` **e continua passando pelo `requireOperacaoAcesso()`**
  (allow-list `OPERACAO_USUARIOS`, mesmo 404 e mesmo fail-open de hoje). Assim, quem vê o Painel
  de Operação depois do deploy é exatamente quem vê hoje, esteja a env vazia ou preenchida. O
  mesmo vale para `/me/permissoes.operacao` e para a navegação. Aposentar a env (e remover o
  `requireOperacaoAcesso`) é um tweak posterior, feito depois que um gestor conceder/revogar
  `operacao:ver` pela tela. Registrar no ADR e no `DEPLOY.md`.
- **Q6 — sem usuário de serviço.** O `kavex-report-ciclo` continua logando com uma conta de admin;
  o dono do ciclo troca a credencial (`FINANCEIRO_API_USUARIO`, hoje = `admin`) ao atualizar o
  admin. Nada de código nesta feature; só registrar no ADR/DEPLOY que desativar a conta `admin`
  quebra o report até a credencial ser trocada.
- **Q2–Q5, Q7–Q13:** defaults aceitos como escritos acima (exceção concede **e** revoga, revogar
  vence; `role` fica sem uso até o passo 3, migration mapeia `admin` → Administrador e aborta em
  outro valor; papéis editados por migration de dados, tela atribui papel e edita exceções; um
  papel por usuário; tabela append-only de eventos de acesso + LogService; `executar` implica
  `ver`; 403 `{ error: 'Você não tem permissão para esta ação.', permissao }`; cache 30 s com
  invalidação no processo; filial fora de escopo; `DEV_AUTH_BYPASS` sem autorização).

### Regra nova

- **R-extra:** a salvaguarda do passo 1 ("nenhum admin desativa a si mesmo nem o último admin
  ativo") passa a ser sobre **`usuarios:gerenciar` efetivo**: nenhuma mudança de papel, exceção ou
  `ativo` pode deixar zero usuários ativos com `usuarios:gerenciar`, nem tirar do próprio chamador.

### Atualização Q1 (2026-09-28, dono do ciclo): `OPERACAO_USUARIOS` está **vazia** em produção

Com a env vazia, o allow-list hoje é fail-open: todo admin vê o Painel de Operação. Dar
`operacao:ver` ao pacote Administrador preserva exatamente quem vê. **Substitui a resolução por
compatibilidade acima:** nesta feature o allow-list é **aposentado** — `requireOperacaoAcesso()`,
`http/operacaoAcesso.ts` e a env `OPERACAO_USUARIOS` saem; `/operacao` passa a exigir só
`operacao:ver` (mantendo o 404 sem corpo explicativo do ADR-0042); `/me/permissoes.operacao` passa a
derivar de `operacao:ver`. Remover a env de `render.yaml`/`.env.example`/`DEPLOY.md` e registrar
no ADR 0053 que ela estava vazia em produção na data da troca.
