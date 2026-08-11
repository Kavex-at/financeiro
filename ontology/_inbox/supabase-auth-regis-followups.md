# Follow-ups — `supabase-auth` (identidade e autorização)

> **Feature:** `supabase-auth` · **ADR:** [0030](../decisions/0030-supabase-auth-identity-provider.md)
> **Data:** 2026-08-06 · **Branch:** `feat/supabase-auth`
>
> Itens **fora do escopo** desta feature, registrados aqui para não sumirem. O primeiro é um
> **carry-over** que a feature não fecha mas **torna barato de fechar**.

---

## P1 — `filialAuthz` fail-**OPEN** ⚠️ carry-over aberto desde **2026-06-22** — **6º Regis-Review consecutivo**

**O achado.** `userCanActOnFilial` (`src/backend/http/filialAuthz.ts:48`) retorna **`true`** quando não
há allow-list:

```ts
const permitidas = filiaisPermitidas(user);
if (permitidas === undefined) return true;   // ← linha 48
```

E a claim `filiais` **nunca foi provisionada em token nenhum** — nem no HS256 legado, nem no caminho
Supabase. Logo `filiaisPermitidas` sempre devolve `undefined`, e `assertUserCanActOnFilial` **nunca
barra ninguém**.

**Consequência hoje, em produção:** qualquer `admin` dispara **borderô, baixa `fin010` e NDe em qualquer
filial**. O guard existe, roda a cada request, e é **inerte**. É a pior categoria de controle de acesso:
o que aparece verde na revisão porque o código está lá.

**Histórico.** Levantado pelo Regis-Review em **2026-06-22** e reaberto em todos os runs seguintes — a
ocorrência mais recente é o card `security-4` de `_inbox/recebimentos-alocar-sn-regis-followups.md`
(*"`permissions.filiais` claim not provisioned — cross-filial guard passes empty"*), listado inclusive
como **must-fix-before-wire-real**. **Seis runs.** O peso do card é o histórico: não é um achado novo,
é um achado que sobreviveu a seis oportunidades de correção.

**Por que esta feature não o fecha.** Escopo explicitamente fechado no plano aprovado
(`app_user_filial` fora). Fechá-lo aqui misturaria duas migrações de segurança num único cutover — e o
cutover de identidade já tem raio suficiente (21 call sites de auditoria + todas as sessões vivas).

**Por que ela o torna barato de fechar.** Antes, popular `filiais` exigia um **Custom Access Token
Hook** configurado no painel do Supabase — fora do repositório, invisível ao code review e ao teste.
Depois da ADR-0030, a autorização **já vem do banco** a cada request (`appUserContext` faz o `SELECT`
que resolve `role`/`ativo`/`username`). Popular `filiais` vira **um `JOIN` com `app_user_filial` na
query que já existe**, sem depender de claim nenhuma.

**Escopo estimado do fechamento:**
1. migration `app_user_filial` (`app_user_id`, `fil_cod`, UNIQUE);
2. `JOIN` no `SELECT` do `appUserContext` → `req.user.filiais: number[]`;
3. **inverter o default da linha 48** para **fail-closed** (`permitidas === undefined` ⇒ `false`),
   com a exceção de migração explícita: enquanto a tabela estiver vazia, `admin` mantém acesso amplo
   **por flag datada**, não por omissão;
4. teste: `operador` com filial 1 recebe **403** ao disparar borderô da filial 4.

**Recomendação:** fechar na **fatia imediatamente seguinte** ao cutover, enquanto o contexto de
`appUserContext` ainda está quente. É o momento mais barato que vai existir.

---

## P1 — I-Usuario-7: mudanças de estado de `Usuario` não são atribuídas

**Gap declarado na ontologia** (`entities/usuario.md`, I-Usuario-7), asseverado mas **não implementado**.

Hoje **só o cadastro** grava o autor (`created_by`). Não registram quem fez:
`PATCH /usuarios/:id/ativo` · `POST /usuarios/:id/reset-senha` · vincular Conexos · desvincular Conexos.

`routes/usuarios.ts:29` **já computa** `ator(req)` — e o usa **exclusivamente** no `create`.

**Por que é desconfortável:** numa plataforma cujo princípio declarado é *"toda ação de sistema e de
usuário é auditada"* (`glossary.md` — Trilha de auditoria), a **desativação de um usuário** e a
**redefinição da senha de terceiro** são hoje as ações **menos** auditadas do sistema — exatamente as
duas com maior potencial de disputa posterior.

**Escopo:** colunas de auditoria em `app_user` (ou tabela `app_user_evento`) + gravar `ator(req)` nos
quatro pontos. Baixo risco, sem efeito no ERP.

---

## P2 — Guarda "não pode restar zero admin ativo"

I-Usuario-6 fecha a **autodesativação** (barata, sem `COUNT`). Continua possível **rebaixar o último
admin** para `operador` e ficar sem ninguém que gere usuários.

**Nota que encarece o escape hatch:** a ADR-0030 remove o default hardcoded `'columbia2026'` do
`seed-admin` (correto — era credencial em código), o que torna a recuperação manual mais cara do que era.

**Escopo:** `COUNT` transacional em `desativarUsuario` e na mudança de `role`. Cuidado com corrida entre
dois admins se desativando simultaneamente (`SELECT ... FOR UPDATE` ou constraint).

---

## P2 — `CONEXOS_CRED_ENC_KEY` ausente do `render.yaml` (pré-existente)

Sem ela, `SecretCipher` fica desabilitado, o **vínculo Conexos por usuário não funciona em produção** e
**tudo já cai no usuário-robô hoje**.

**Efeito na ontologia:** **I-Usuario-5 está INERTE em produção neste momento** — a ontologia assevera
uma invariante que o ambiente não exerce. Registrado explicitamente em `entities/usuario.md` e
`actions/usuario/vincular-conexos.md` porque **uma invariante inerte parece cumprida**, e a diferença só
aparece quando alguém audita quem assinou uma baixa.

**Não causado por esta feature.** Provisionar junto das variáveis novas (ADR-0030 §10, item 7).

---

## Docs-as-code — **aplicar no PR, junto do código** (task para o TaskScoper)

> **Deliberadamente NÃO escritos agora.** Estes arquivos descrevem o sistema **em execução**;
> atualizá-los hoje os tornaria **falsos** entre o merge da ontologia e o deploy. Aplicar no mesmo PR
> que sobe o código.

### `DEPLOY.md`

| Linha | Trecho atual | Mudança |
|---|---|---|
| 3 | `Stack de deploy: **Supabase** (Postgres) + **Render** (backend Express) + **Vercel** (frontend Next.js).` | acrescentar Supabase **Auth (GoTrue)** ao lado do Postgres |
| 4-5 | `O auth é um **login simples usuário/senha** — o backend valida a senha (bcrypt) contra a tabela ` `app_user` ` e assina um JWT HS256 próprio (`AUTH_JWT_SECRET`). Sem Supabase Auth / OAuth.` | **reescrever**: identidade no GoTrue (ES256/JWKS); autorização resolvida de `app_user` a cada request; HS256 legado sobrevive atrás de `AUTH_LEGACY_LOGIN_ENABLED` durante o rollout |
| 15 | `3. Não é preciso configurar Supabase Auth — só o Postgres é usado.` | **inverter** — substituir pelos 9 passos humanos da ADR-0030 §10 (signup público OFF, SMTP, URL config, templates PT-BR, JWT keys ECC P-256, sessions, envs) |
| 44 | `` | `AUTH_JWT_SECRET` | **gerar forte** — … Assina/valida os tokens de login | `` | marcar como **legado do rollout**; adicionar `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (`sync: false`), `AUTH_LEGACY_LOGIN_ENABLED` — **e `CONEXOS_CRED_ENC_KEY`** |
| 57, 89 | geração do `AUTH_JWT_SECRET` como passo obrigatório | rebaixar a passo **de rollout**, removível na Fase 4 |
| 96 | `7. Acessar https://<app>.vercel.app/login e entrar com ADMIN_USERNAME / ADMIN_PASSWORD.` | ajustar: `seed-admin` passa a semear **via Supabase** e **falha** se `ADMIN_PASSWORD` não vier do ambiente (o default `'columbia2026'` é removido) |

### `README.md`

| Linha | Trecho atual | Mudança |
|---|---|---|
| 29 | `Express/DDD com auth Supabase + cliente Conexos, frontend Next.js com Design System.` | **hoje é falso, passa a ser verdade** — precisar para "auth Supabase (GoTrue) + autorização por `app_user`" |
| 61 | `Dev sem Supabase: `.env` … já com `DEV_AUTH_BYPASS=true` …` | acrescentar que o bypass passa a injetar um **usuário sintético** (`dev-bypass@local`), corrigindo o 401 em toda mutação em dev |

### `CLAUDE.md`

| Onde | Trecho atual | Mudança |
|---|---|---|
| tabela **Estado Atual vs. Alvo**, linha `Auth / DB` | `Supabase (JWT + Postgres)` → alvo `SSO corporativo + RBAC` | precisar o **atual** para "Supabase Auth (GoTrue, ES256/JWKS) + autorização resolvida de `app_user`"; anotar que a costura para o **SSO corporativo** já está pronta (ligar o provider não muda uma linha do backend) |

---

## Follow-ups NOVOS, abertos durante a implementação (2026-08-06)

> Registrados aqui e **não implementados** — nenhum é P0. A regra do loop: só P0 volta ao ciclo.

### P2 — Migrar os formulários para `react-hook-form` + `zod` e criar as moléculas que faltam

`docs/design-system/forms.md` especifica `FormField`, `TextInput` e `PasswordInput`. **Nenhum dos
três existe** em `components/ui/`. `react-hook-form` está instalado e tem **zero uso** no repositório.

A migração foi **deliberadamente adiada** desta feature (§D3 do `tasks.md`), e a razão decisiva não é
esforço: **a página de login é a única porta de entrada durante um cutover cujo modo de falha
declarado é lockout geral.** Reescrevê-la no mesmo PR que troca o provedor de identidade removeria
justamente a peça que precisa continuar funcionando enquanto tudo em volta muda. As duas telas novas
(`/auth/forgot-password`, `/auth/reset-password`) seguem o mesmo idioma manual, para não estrear um
padrão de formulário dentro do cutover.

**Escopo quando for feito:** criar as três moléculas, migrar `/login`, `/auth/*`, `NovoUsuarioDialog`
e `ResetSenhaDialog`. Preservar os `data-testid` existentes — eles são o contrato dos testes de tela.

### P2 — `AuthProvider` a 58% de cobertura de linhas

O provider concentra a lógica de sessão mais sensível do frontend e está coberto principalmente pelo
caminho feliz (`__tests__/auth/useIsAdmin.test.tsx`). Não coberto: `signIn` com erro, `signOut` com o
provedor fora, e as transições de `onAuthStateChange` (`SIGNED_OUT`, `TOKEN_REFRESHED`). O piso de
`./lib/auth/` no `jest.config.js` (24% linhas) está folgado demais para pegar uma regressão aqui.

### P3 — Constante de base-URL da API duplicada

`lib/api.ts:20`, `lib/usuarios.ts`, `lib/recebimentos.ts` e `lib/sispag.ts` repetem
`(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')`. Unificar num
módulo só. Baixo risco, e a duplicação já sobreviveu a várias features — o custo real é a chance de
uma cópia divergir num ambiente novo.

### P3 — Complexidade cognitiva de `buildAppUserContextMiddleware` (27 × máx. 15)

Warning do Biome, na mesma classe dos ~35 pré-existentes do repositório (o `check` sai 0). A extração
do ramo U2 (`resolveInactive`) já reduziu de 29 para 27; o restante é inerente às seis decisões que o
middleware toma (bypass, sem-sub, 3 ramos de cache, 3 ramos de banco). Fatiar mais **espalharia a
lógica de segurança por mais funções**, que é o oposto do que se quer num gate fail-closed — daí ficar
como follow-up consciente, e não como refatoração automática.

### P1 — Duas invariantes de `Usuario` seguem declaradas e não enforçadas

- **I-Usuario-7** — `PATCH /:id/ativo`, `POST /:id/reset-senha` e vincular/desvincular **não
  registram quem fez**. O ator já é resolvido e passado ao service (`auditActor(req)`); falta a
  coluna/tabela de auditoria. Numa plataforma cujo princípio é *"toda ação é auditada"*, a desativação
  de um usuário segue sendo uma das ações **menos** auditadas do sistema.
- **I-Usuario-5** — permanece **INERTE em produção** enquanto `CONEXOS_CRED_ENC_KEY` não for
  provisionada. A variável foi adicionada ao `render.yaml` (`sync: false`) por esta feature, mas
  **preenchê-la no dashboard é passo humano**. Até lá, todas as baixas `fin010` continuam saindo no
  nome do usuário-robô — sem erro, sem log e sem alarme.

---

## P1 — `app_user.username` é um LOGIN, não um e-mail — e o GoTrue só aceita e-mail

> **Levantado pelo Yuri em 2026-08-10**, na revisão do cutover. Registrado, **não implementado**:
> fechá-lo exige migration + decisão de produto sobre o login das pessoas.

**O fato.** `migrations/0007_app_user.sql` declara `username TEXT UNIQUE NOT NULL` — string livre,
**sem formato de e-mail**. A ADR-0030 fala de *"`app_user.username` (o e-mail)"* como se fossem a
mesma coisa; isso vale para as linhas que **por acaso** foram cadastradas com e-mail, e não é uma
garantia do schema. Não existe uma segunda coluna com o e-mail real da pessoa.

**Por que não é cosmético.** O GoTrue **valida formato de e-mail** ao criar usuário, e o job de
migração alimenta o campo direto:

```
jobs/migrate-users-to-supabase.ts:88   →   createUserWithPasswordHash({ email: user.username, … })
```

Para um `username` que não seja e-mail (`marilyn`, `financeiro01`), o provedor **recusa a criação**.
Em cadeia:

1. o usuário cai em `usernamesComFalha` e **nunca ganha `auth_user_id`**;
2. `listPendingMigration()` **nunca volta vazia** — e ela é o **gate da Fase 3** (ADR-0030 §6/I13),
   não um relatório. O cutover **trava** — e trava do lado certo;
3. desligar `AUTH_LEGACY_LOGIN_ENABLED` assim mesmo deixaria essa pessoa **sem nenhum caminho de
   login**: o legado desligado e ela inexistente no provedor. É exatamente o lockout que o gate
   existe para impedir.

O mesmo vale para `convidarUsuario` / `cadastrarUsuarioComSenha`: do cutover em diante todo cadastro
novo **é** um e-mail, porque é ele que recebe o convite e o link de recuperação.

**Escopo do fechamento:**

1. migration: coluna `email TEXT UNIQUE` em `app_user`, com backfill `email = username` onde o
   `username` já for e-mail; o resto é **levantamento manual** — não há como derivar;
2. o job passa a mandar `email` (não `username`) ao GoTrue; `listPendingMigration()` passa a exigir
   `email IS NOT NULL` e vira gate também disso;
3. **`username` continua sendo o ator da trilha** durante a transição. Trocá-lo agora partiria
   `executado_por` / `criado_por` / `created_by` em dois formatos — precisamente o que
   `business-rules/ator-da-trilha-de-auditoria.md` proíbe;
4. **depois** de todo mundo migrado e com `email` preenchido, escolher: (a) `UPDATE app_user SET
   username = email`, que unifica os dois mas **exige migração das colunas de auditoria** de quem não
   usava e-mail; ou (b) manter `username` como identificador histórico imutável e usar `email` só
   para o provedor. **(b) é mais barata e não reescreve histórico**; (a) só se paga se alguém for ler
   a trilha esperando e-mail em 100% das linhas.

**Como dimensionar antes de decidir** (leitura pura, roda hoje):

```sql
SELECT count(*) FILTER (WHERE username NOT LIKE '%@%') AS sem_email,
       count(*)                                        AS total
FROM app_user;
```

`sem_email = 0` rebaixa o item a P3 documental: a ADR passa a poder **afirmar** o que hoje presume, e
a coluna `email` continua valendo como garantia contra o **próximo** cadastro feito com login curto.

**Por que não foi feito agora.** O cutover já carrega raio suficiente (todas as sessões vivas + 21
call sites de auditoria). Somar uma migration que mexe na **chave de junção do vínculo Conexos**
(`getVinculoConexos(username)`) e no ator da trilha faria duas mudanças irreversíveis viajarem no
mesmo PR. E o gate da Fase 3 **já protege** contra o modo de falha: o pior caso hoje é o cutover não
avançar — não alguém ficar trancado do lado de fora.

---

## Referências

- `ontology/decisions/0030-supabase-auth-identity-provider.md`
- `ontology/entities/usuario.md` · `ontology/state-machines/usuario.md`
- `ontology/business-rules/{autorizacao-resolvida-do-banco,ator-da-trilha-de-auditoria,revogacao-de-acesso}.md`
- `ontology/integrations/supabase-auth.md`
- `ontology/_inbox/supabase-auth-interview.md`
