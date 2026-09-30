---
adr_number: 0053
title: Permissões por módulo, guardadas no banco e lidas a cada requisição; o token só identifica
date: 2026-09-28
status: accepted
type: change
related_entities: []
related_actions: []
related_integrations: [kavex-report-ciclo]
evidence:
  - src/backend/domain/interface/auth/Permission.ts
  - src/backend/domain/service/auth/EffectivePermissionCalculator.ts
  - src/backend/domain/service/auth/AccessService.ts
  - src/backend/domain/repository/auth/AccessRepository.ts
  - src/backend/http/acesso.ts
  - src/backend/http/routePermissions.test.ts
  - src/backend/migrations/0066_auth_permissoes_modulo.sql
  - src/backend/migrations/rollbacks/0066_auth_permissoes_modulo.rollback.sql
  - ontology/_inbox/auth-permissoes-modulo-interview.md
  - ontology/_inbox/auth-permissoes-modulo-tasks.md
  - ontology/_inbox/auth-permissoes-modulo-gap.md
supersedes_decisions: []
amends_decisions: [0011, 0042]
---

# ADR 0053: permissões por módulo no banco, nunca no token

> **Continuada pela ADR-0056 (2026-09-30):** com o Supabase Auth, a chave de lookup muda só na
> metade `token → app_user` (`app_user.auth_user_id` para o emissor `supabase`); as permissões
> continuam no banco, lidas a cada requisição (I1).

**Cliente:** Columbia Trading · **Entrega:** Kavex · **Branch:** `feat/auth-permissoes-modulo`.
Passo 2 de 3 do plano de auth da ADR-0051 (e-mails reais → **permissões no banco** → Supabase Auth).
`entity_changed = false`: papéis e permissões são infraestrutura de acesso, na mesma prateleira do
`app_user`. Nenhum arquivo em `ontology/entities/` muda.

> Número reservado por esta branch, assim como a migration 0066. Reconferir os dois contra a `main`
> no rebase: sessões paralelas já colidiram na numeração antes (ver ADR-0048).

## Contexto

A autorização do backend era um único guard binário, `requireRole('admin')` (ADR-0011), que lia o
claim `role` do token. Em produção, em 2026-09-28, os 15 usuários (14 ativos) eram todos `admin`, então
o guard não recortava ninguém: servia só para barrar tokens estranhos. O único recorte real era o
allow-list `OPERACAO_USUARIOS` do Painel de Operação (ADR-0042), um CSV de `username` numa env var.

A Columbia precisa de recortes por frente (quem só consulta SISPAG, quem executa Permutas) e o passo 3
vai trocar o emissor do token pelo Supabase Auth. Se a autorização continuar dentro do token, o passo 3
precisa reescrevê-la. Havia ainda a lacuna registrada na ADR-0051: desativar um usuário não derruba o
token que ele já tem, válido por até 12 h.

## Decisão

### D1. Catálogo fixo de nove permissões, no código

`domain/interface/auth/Permission.ts` define o catálogo, sem tabela:

| Módulo | Permissões |
|---|---|
| Permutas | `permutas:ver`, `permutas:executar` |
| SISPAG | `sispag:ver`, `sispag:executar` |
| Recebimentos (Adiantamentos) | `recebimentos:ver`, `recebimentos:executar` |
| Plataforma | `operacao:ver`, `metricas:ver`, `usuarios:gerenciar` |

Rotas e telas usam as constantes (`PERMISSION.*`), nunca a string crua. As duas colunas `permission`
do banco (`app_role_permission`, `user_permission`) têm um `CHECK (permission IN (...))` com a mesma
lista (R4), e o teste da 0066 compara as duas listas: acrescentar uma permissão no código sem a
migration que troca o `CHECK` quebra o teste. Um valor que sobrar no banco depois de sair do código é
ignorado pelo cálculo, com aviso no log; a requisição não cai.

### D2. Papéis são pacotes; exceções por usuário concedem ou revogam

- **`app_role`** + **`app_role_permission`**: um papel é um pacote nomeado de permissões. Pacotes
  mudam só por migration de dados (Q4). A tela atribui papel e edita exceções; não cria papéis.
- **`app_user.role_id`**: um papel por usuário (Q5), `NOT NULL` depois do backfill.
- **`user_permission`**: exceções por usuário, chaveadas por `app_user.id`, com `efeito` =
  `conceder` | `revogar` (Q2). PK `(user_id, permission)`: a mesma permissão não pode ser concedida e
  revogada ao mesmo tempo para a mesma pessoa.

**Fórmula das efetivas**, calculada **só** no `EffectivePermissionCalculator` (I7):

```
efetivas = fecho(pacote(papel) ∪ concedidas) − revogadas
```

`fecho` acrescenta `X:ver` para todo `X:executar` (quem executa vê). Revogar `X:ver` tira também
`X:executar` (quem não vê não executa). Revogar vence conceder. O middleware de acesso, a guarda do
último gestor e a listagem da tela de usuários chamam essa classe; nenhum deles reimplementa a regra,
e o frontend recebe as efetivas prontas do servidor.

**Dia do deploy (I6):** a 0066 semeia o papel `Administrador` com as nove permissões e o atribui a
todos os usuários existentes. Ela aborta, antes de qualquer DDL e com mensagem em português, se
encontrar `app_user.role` diferente de `'admin'` (Q3): não há papel correspondente, e semear um
segundo papel por especulação seria pior do que parar. Os papéis reais da Columbia vêm depois, e essa
mudança é só de dados.

### D3. Permissão nunca vem do token (I1); a chave é `app_user.id`

O token continua como na ADR-0051: `sub = username`, claim `role`, `aud`, `iat`, `exp`. Não ganha
claim de permissão, de papel novo nem de `id`. Nenhum guard do servidor lê `req.user.role`; o claim
continua sendo emitido só para o frontend antigo na janela de deploy.

O lookup tem duas metades: `sub → app_user` (pelo índice único em `lower(username)` do passo 1) e
`app_user.id → permissões`. As tabelas de permissão são chaveadas por `app_user.id`, e não por
`username`, porque no passo 3 o `sub` passa a ser o UUID do Supabase: muda só a primeira metade do
lookup, e papéis, exceções e trilha ficam como estão.

### D4. Resolução por requisição, com cache de 30 s e falha fechada

Ordem no `buildApp`: `buildAuthMiddleware` (quem é) → `resolverAcesso` (existe, está ativo, o que
pode) → `conexosIdentity` (com que sessão fala com o ERP) → guard da rota.

- **`AccessService`** (`@singleton`) resolve `sub → acesso` em **uma** ida ao banco e guarda o
  resultado em memória por **30 s** (`CACHE_TTL_MS`). Toda escrita de acesso feita pela tela (papel,
  exceções, ativo, criação) chama `invalidar(userId)` no próprio processo depois do commit: a próxima
  requisição do alvo relê o banco. O TTL é a rede de segurança para o que não passa pela tela (SQL
  manual) e para a sobreposição de instâncias no deploy. Usuário inexistente não é cacheado; erro do
  repositório não é cacheado.
- **Ressalva de instâncias:** hoje há **uma** instância web no Render (`render.yaml`: `plan: starter`,
  sem `numInstances`). Se o número de instâncias subir, a invalidação no processo não alcança as
  outras, e o pior caso de qualquer mudança feita pela tela passa a ser os 30 s do TTL. Quem subir
  `numInstances` precisa revisitar esta decisão (invalidação distribuída ou TTL menor).
- **Falha fechada:** se o banco não puder ser lido, `resolverAcesso` responde **503** ("Não foi
  possível verificar suas permissões agora. Tente novamente em instantes.") e loga o erro em
  português com o `requestId`. Nunca libera por não saber. A única falha aberta que existia na
  autorização (`OPERACAO_USUARIOS` vazia = todo admin entra) deixou de existir (D8).
- **O `AccessService` não entra no `bootstrapAppContainer`** (gotcha dos ~58 jobs): é resolvido sob
  demanda pelo middleware. Jobs não passam por guard.

### D5. Usuário inexistente ou inativo recebe 401 (fecha a lacuna da ADR-0051)

`sub` sem `app_user` correspondente, ou com `ativo = false`, recebe **401** ("Sessão encerrada: seu
acesso foi desativado ou não existe mais.") em qualquer rota autenticada. O frontend já trata 401 como
sessão encerrada. Desativar alguém pela tela invalida o cache dele, então a próxima requisição já é
recusada; por SQL direto, em até 30 s. A lacuna de até 12 h da ADR-0051 fecha aqui.

### D6. Nunca zero gestores; ninguém tira o próprio acesso (R9, R-extra)

A salvaguarda do passo 1 ("último admin ativo", que olhava `role = 'admin'`) passa a ser sobre
**`usuarios:gerenciar` efetivo**. Nenhuma troca de papel, alteração de exceções ou desativação pode:

- deixar zero usuários ativos com `usuarios:gerenciar` efetivo → 409 `LastUserManagerError`;
- tirar `usuarios:gerenciar` do próprio chamador → 409 `SelfAccessRemovalError`;
- desativar o próprio chamador → 409 `SelfDeactivationError` (mantida do passo 1).

As três escritas passam pelo **mesmo** `AccessRepository.lockAndCheck`, dentro da transação da escrita:
trava os usuários ativos com `FOR UPDATE`, em ordem de id, **antes** de ler o alvo; trava o alvo; lê
papel, pacote e exceções na mesma transação; simula o estado depois da escrita com o
`EffectivePermissionCalculator`; e só então escreve. Duas mudanças concorrentes serializam, e a segunda
relê o estado já com a primeira. Verificado ao vivo em Postgres descartável com 10 de 10 corridas
concorrentes (dois gestores retirando um ao outro ao mesmo tempo): em todas, uma passou e a outra
recebeu 409.

Em uso normal pela tela o 409 de "último gestor" não é alcançável: quem chega a `/usuarios` está
ativo e tem `usuarios:gerenciar`, e a regra "a própria" é checada antes. A guarda de contagem protege
as corridas e a janela de cache, e é obrigatória porque errar aqui tranca a gestão de usuários (só
SQL direto resolveria).

### D7. Trilha append-only de toda mudança de acesso (Q7, R12)

`app_user_access_event (ator, alvo_user_id, tipo, antes, depois, em)`, com `tipo` em `papel` |
`excecao` | `ativo` e `antes`/`depois` em JSON (papel: `{ id, nome }`; exceção: lista ordenada; ativo:
booleano). Uma linha por escrita efetiva, gravada **na mesma transação** da escrita; criar usuário
grava `papel` com `antes = null`, reativar grava `ativo` `false → true`. Escrita que não muda nada
(mesmo papel, mesmo conjunto de exceções) não grava evento. O código só faz `INSERT` nessa tabela
(teste sobre o fonte dos repositórios). Além da linha, cada mudança emite uma linha de `LogService` em
português com ator, alvo, tipo e antes → depois. Leitura da trilha é por SQL; tela fica fora de
escopo. O `ator` é o `sub` (`username`), a mesma identidade de auditoria da ADR-0051.

### D8. Um guard explícito por rota, conferido por teste

Cada rota autenticada tem **exatamente um** guard: `exigirPermissao(p)` ou `somenteAutenticado()`.
`exigirPermissao` responde **403** `{ error: 'Você não tem permissão para esta ação.', permissao }`
(Q9), com exceção de `operacao:ver`, que responde **404** `{ error: 'Not found' }` (D10). As flags de
frente (`sispagGate`, `recebimentosGate`) continuam rodando **antes** do guard (I8): permissão não
liga frente desligada, e flag não concede permissão. `filialAuthz` continua depois do guard, sem
mudança (D11).

`src/backend/http/routePermissions.test.ts` percorre os routers montados e exige que o conjunto de
rotas encontradas seja igual ao da tabela do teste, cada uma com um único guard marcado. Rota nova sem
linha na tabela, ou linha sem rota, falha o teste nomeando a rota; um router novo montado no
`buildApp` sem entrar no teste também falha. Um segundo teste, comportamental e por linha, confere 403
sem a permissão e passagem com só ela.

Mapeamento (85 rotas autenticadas; "hoje" = antes desta ADR):

| Área | `ver` / autenticado | `executar` / gerenciar |
|---|---|---|
| `/permutas` (27) | leituras: `runs`, `cliente-filtro`, `importadores`, `invoices/buscar`, `gestao`, `relatorios/:tipo`, `adiantamentos/:docCod/execucoes`, e (JC-2) `borderos`, `borderos/:borCod/baixas`, `status` | toda mutação (alocar, exceção manual, processar, reconciliar, gerar numerário, reconciliar lote, borderôs, cliente-filtro) e (JC-1) `eleicao`, `ingestao` |
| `/sispag` (27) | `painel`, `retornos`, `lotes`, `lotes/:id`, `lotes/:id/modalidades-disponiveis`, `ingestao/runs`, `lotes/:id/remessa/janela`, e (decisão abaixo) `lotes/:id/linhas-digitaveis`, `boletos-dda` | toda mutação de lote, remessa e retorno; (JC-1) `ingestao`, `boletos-dda/sincronizar`; (JC-3) `contas-pagadoras`, `lotes/:id/remessa/arquivo`; (JC-4) `execucoes` |
| `/recebimentos` (15) | `painel`, `painel/enriquecimento`, `clientes`, `transacoes/:txnId/processos`, `processos/:priCod/sns`, `ingestao/runs`, (JC-3) `contas` | `pipeline/run`, `ingestao`, `ingestao/upload/preview`, `ingestao/upload`, `solicitacao-numerario`, `arquivar`, `desarquivar`; (JC-4) `execucoes` |
| `/usuarios` (10) | | todas em `usuarios:gerenciar` (as 7 de antes + `GET /papeis`, `PATCH /:id/papel`, `PUT /:id/permissoes`) |
| `/operacao` (2) | `GET /` e (JC-5) `POST /alertas/:id/reconhecer` em `operacao:ver` | |
| `/metricas` (1) | `GET /ciclo` em `metricas:ver` | |
| `/me` (2), `/conexos` (1) | (JC-6) `somenteAutenticado` | |

Rotas públicas, sem mudança: `/health`, `/health/*`, `/auth/login`, `/auth/transicao`.

Chamadas de julgamento, aprovadas pelo dono do ciclo:

- **JC-1:** ingestões, eleição, pipeline e sincronizar DDA ficam em `executar` (como hoje). Quem só
  vê não tem "Atualizar dados" e depende dos crons.
- **JC-2:** `GET /permutas/borderos` (inclusive `?live=true`, que lê o ERP ao vivo e consome sessão
  do Conexos), `/borderos/:borCod/baixas` e `/permutas/status` **descem** de admin para
  `permutas:ver`. `/status` é chamada no load da tela principal; em `executar`, o usuário só-leitura
  teria tela quebrada.
- **JC-3:** `GET /sispag/contas-pagadoras` (dado bancário da empresa) e
  `GET /sispag/lotes/:id/remessa/arquivo` (CNAB com banco, agência e conta de cada fornecedor; LGPD,
  LC 105) ficam em `sispag:executar`. `GET /recebimentos/contas` (contas `fin133`, aberta antes) fica
  em `recebimentos:ver`. **A assimetria é consciente e fica registrada:** igualar é outro tweak.
- **JC-4:** `GET /sispag/execucoes` e `GET /recebimentos/execucoes` (triagem de órfãos, sem chamador
  no front) ficam em `<frente>:executar`.
- **JC-5:** reconhecer alerta exige só `operacao:ver`; não existe `operacao:executar`.
- **JC-6:** `/me/*` e `/conexos/filiais` exigem só usuário existente e ativo, sem permissão de
  módulo: são sobre o próprio usuário, ou o seletor de filial usado pelas três frentes.

**Linhas digitáveis e boletos DDA em `sispag:ver`.** A entrevista listou
`GET /sispag/lotes/:id/linhas-digitaveis` e `GET /sispag/boletos-dda` como "hoje: aberta →
`sispag:ver`", mas o código da `main` (v0.43.1) já as protegia com `requireRole('admin')`, com
comentário de LGPD (linha digitável e código de barras carregam banco, agência e conta do cedente no
campo livre, mais o valor). A pergunta foi ao dono do ciclo, que decidiu em 2026-09-29: **basta
`sispag:ver`** — conferir boleto faz parte de acompanhar o lote. Continuam em `sispag:executar` o
download do `.REM`, as contas pagadoras e o "Atualizar DDA" (sincronizar com o fin124). Registro em
`ontology/_inbox/auth-permissoes-modulo-gap.md`.

### D9. `DEV_AUTH_BYPASS` é um usuário fictício com as nove permissões

Com o bypass ligado, `resolverAcesso` preenche `req.user` e `req.acesso` com um usuário constante,
`sub = 'dev-bypass'`, papel `Administrador`, as nove permissões, **sem consultar o banco**. Nenhuma
linha de `app_user` é criada ou lida; escritas feitas sob bypass gravam o ator `dev-bypass`. No
front, `usePermissoes()` em bypass devolve o catálogo inteiro. Substitui o default do Q13 da entrevista
(bypass sem autorização), por decisão do dono do ciclo. O bypass só é alcançável em local/dev: o
`loadAuthEnv` derruba o boot se `DEV_AUTH_BYPASS=true` chegar a outro ambiente, e isso tem teste.

### D10. Painel de Operação: allow-list aposentado, 404 mantido

`OPERACAO_USUARIOS`, `requireOperacaoAcesso()` e `http/operacaoAcesso.ts` saem. `/operacao` exige só
`operacao:ver`. A env estava **vazia em produção em 2026-09-28** (confirmado pelo dono do ciclo); vazia,
o allow-list era fail-open e todo admin via o painel. Como todo usuário é admin e recebe o papel
Administrador, que tem `operacao:ver`, **quem vê o painel depois do deploy é exatamente quem via
antes**. O 404 sem corpo explicativo da ADR-0042 é mantido: para quem não tem `operacao:ver`, o
painel não existe. `GET /me/permissoes` passa a devolver `{ permissoes, papel, operacao }`, com
`operacao` derivada de `operacao:ver` e mantida só por compatibilidade com o front antigo (sai num
tweak posterior).

### D11. Fora de escopo, registrado

- **Q6, conta do `kavex-report-ciclo`.** Ele loga como um usuário comum (`FINANCEIRO_API_USUARIO`,
  hoje = `admin`) e precisa de `metricas:ver`. Não há usuário de serviço nesta feature. **Desativar a
  conta compartilhada `admin` quebra o report até `FINANCEIRO_API_USUARIO` ser trocada** por uma conta
  ativa com `metricas:ver`. Está no `DEPLOY.md`.
- **Q12, `filialAuthz`.** Continua lendo o claim `filiais` do **token**, o que contraria o I1 desta
  ADR. Ficou intocado. Quando o recorte por filial for feito, ele vem do banco, como as permissões.
- **Coluna `app_user.role`.** Fica, sem uso para autorização, até o passo 3 (D12).

### D12. Janela de deploy e reversão

- **Criar usuário (D2 das tasks).** `POST /usuarios` exige `papelId` (Q3, sem default). Na janela em
  que o front antigo ainda está no ar, `role: 'admin'` sem `papelId` é aceito como alias do papel
  Administrador; `role: 'operador'` (o default do diálogo antigo) ou nenhum dos dois recebe 400
  "Atualize a página para escolher o papel do usuário.". O alias sai com a coluna `role` no passo 3.
- **Coluna `role` (D3 das tasks).** O código novo nunca escreve `app_user.role`; o `DEFAULT 'admin'`
  da 0007 a preenche. Assim o claim `role` de todo token continua `'admin'`, que é o que o front antigo
  espera. Nenhum guard lê a coluna. Remoção no passo 3.
- **Front novo com backend antigo (D4 das tasks).** Se `/me/permissoes` não trouxer o array
  `permissoes`, o front cai no comportamento legado: catálogo inteiro para `role === 'admin'` e
  `operacao:ver` conforme a chave `operacao`. É só ergonomia de UI (o gate real é o backend antigo,
  por `role`) e torna a ordem de deploy indiferente. Sai no tweak que remover a chave `operacao`.
- **Migration antes do backend.** Os crons do GitHub Actions rodam `npm run migrate` contra
  produção, então a 0066 pode ser aplicada antes de o Render terminar de publicar o backend novo.
  Nessa janela o `POST /usuarios` do backend antigo falha (o `INSERT` dele não passa `role_id`, que é
  `NOT NULL`). São minutos, e só criar usuário é afetado; login e as demais rotas seguem.
- **Instância antiga durante o switch do Render.** Continua com `requireRole` e sem ler o banco;
  ninguém perde acesso. A lacuna das 12 h só fecha quando a instância nova estiver sozinha.
- **Reversão (D7 das tasks).** `migrations/rollbacks/0066_auth_permissoes_modulo.rollback.sql`
  derruba `app_user.role_id`, `app_user_access_event`, `user_permission`, `app_role_permission` e
  `app_role`, e não toca `role`. Deve ser aplicado **só depois** de voltar o backend para a v0.43.1:
  com o backend novo no ar, derrubar as tabelas faz toda requisição autenticada responder 503. **A
  trilha de acesso gravada desde o deploy se perde** (o script traz o `\copy` para exportá-la antes).

## Emendas a outras ADRs

- **ADR-0011** (RBAC server-side): `requireRole` deixa de existir no código. "Toda nova rota de
  mutação deve usar `requireRole('admin')`" e "leituras seguem abertas a qualquer autenticado" são
  substituídas por: **toda rota autenticada tem exatamente um guard explícito** (`exigirPermissao` ou
  `somenteAutenticado`), conferido pelo teste de cobertura por introspecção. O `role` do token não é
  mais fonte de autorização. A parte de redação de log (security-3) não muda.
- **ADR-0042** (o sistema relata a própria execução): o recorte do Painel de Operação por
  `OPERACAO_USUARIOS` é substituído pela permissão `operacao:ver` (D10). Mantidos: o 404 sem corpo, o
  gate server-side nas duas rotas, `GET /health/pipelines` público. Reconhecer alerta exige só
  `operacao:ver` (JC-5). O `ConfigDoctor` deixa de listar a variável.

## Consequências

- No dia do deploy ninguém ganha nem perde acesso (I6): todo usuário é Administrador, com as nove,
  e a única rota que muda de faixa para baixo (JC-2) é leitura. O roteiro de QA confere isso.
- Recortar a Columbia em papéis reais passa a ser migration de dados (novos pacotes) mais atribuição
  pela tela, sem código de aplicação.
- Uma consulta a mais por usuário a cada 30 s quando o cache está frio. Com ~15 usuários, desprezível.
- A guarda R9 trava todas as linhas ativas de `app_user` em cada escrita de acesso. Trivial com ~15
  usuários; vira ponto de contenção só se a base crescer muito.
- Acrescentar uma permissão exige três mudanças coordenadas (constante, migration que troca o
  `CHECK`, linha no teste de rotas), e os testes tornam o esquecimento visível.
- O teste de cobertura depende da forma interna do Express 5 (`router.stack`). Se ela mudar, o teste
  quebra alto; o teste comportamental por linha é a segunda rede.
- Os textos dos 409 do passo 1 mudam ("último administrador ativo" vira "último usuário com permissão
  de gerenciar usuários").
- O passo 3 herda: trocar a metade `sub → app_user` do lookup para o UUID do Supabase, remover a
  coluna `role`, o claim `role`, o alias `role: 'admin'` do `POST /usuarios` e o fallback legado do
  front. As tabelas de permissão não mudam.

## Alternativas consideradas

- **Permissões no token (claims).** Descartada: o passo 3 troca o emissor do token e teria de
  reescrever a autorização; e uma permissão retirada só valeria quando o token expirasse (até 12 h),
  a mesma lacuna que esta ADR fecha.
- **Catálogo de permissões em tabela.** Descartada: toda permissão nova exige código que a use (rota
  com guard, botão na tela), então uma tabela editável só criaria permissões sem efeito. O `CHECK` no
  banco dá a mesma integridade.
- **Só conceder, sem revogar.** Mais simples, mas "Analista, menos executar SISPAG" viraria um papel
  por pessoa. Com poucos papéis grossos e quase todo mundo nas três frentes, revogar é o caso comum.
- **Vários papéis por usuário.** Descartada: exceções cobrem o resto, e o cálculo e a tela ficam
  triviais com um só.
- **Cache com invalidação distribuída (ou sem cache).** Sem cache, uma consulta por requisição; com
  invalidação distribuída, infraestrutura que uma instância não precisa. Cache no processo com TTL
  curto cobre o caso de hoje, com a ressalva de instâncias escrita em D4.
- **Manter `OPERACAO_USUARIOS` convivendo com `operacao:ver`.** Chegou a ser a resolução do Q1 por
  compatibilidade; ficou desnecessária quando o dono do ciclo confirmou a env vazia em produção.
- **Bypass de dev sem autorização (default do Q13).** Deixaria toda rota com guard respondendo 401 em
  dev com bypass; o dono do ciclo preferiu o usuário fictício com acesso total, restrito a local/dev.
