# Runbook — rotação dos segredos de produção

> Aberto pelo Regis-Review de 2026-08-24 (card `security-2`, P0 — bloqueia o merge).
> **Este runbook é ação humana.** O código já foi ajustado (ver §4); o que falta aqui só
> pode ser feito por quem tem acesso ao Render, à Supabase e à Francinei.

## 1. Por que

O `.env` de desenvolvimento da máquina do Yuri carrega, em texto puro, quatro segredos que
são de **produção**:

| Segredo | O que ele dá a quem tiver | Onde é usado |
|---|---|---|
| `AUTH_JWT_SECRET` | assinar um token válido para **qualquer** usuário do app | login da aplicação |
| `CONEXOS_PASSWORD` (`MPS_FRANCINEI`) | sessão no ERP como uma **pessoa real** | toda chamada Conexos |
| `ADMIN_PASSWORD` | seed do admin da aplicação | bootstrap de usuário |
| `databaseConnectionString` | SQL direto na Supabase compartilhada | banco inteiro |

O arquivo está gitignorado e o histórico está limpo (`git log --all -S` → 0 hits), então a via
"vazou por commit" não aconteceu. O risco que sobra é o físico e o operacional: cada laptop,
cada worktree do pipeline `/feature-*`, cada backup pessoal em nuvem carrega essa cópia. Também
foi lido por agente automatizado durante o desenvolvimento do SISPAG — o que já basta para
tratar os quatro como comprometidos por precaução.

## 2. Ordem de rotação

A ordem importa: rotacionar o JWT derruba as sessões, então faça no fim do expediente ou
avise o time antes.

1. **`databaseConnectionString`** — trocar a senha do usuário Postgres na Supabase
   (Dashboard → Settings → Database → Reset database password). Atualizar no Render
   (`financeiro-backend` → Environment) **antes** do reset propagar, ou aceitar um
   downtime de ~1min. Guardar a nova só no dashboard.
2. **`ADMIN_PASSWORD`** — gerar valor novo, atualizar no Render, redeploy. Conferir que o
   login do admin ainda funciona.
3. **`CONEXOS_PASSWORD`** — **precisa da Francinei**. É a senha nominal dela no ERP; trocar
   sem avisar quebra o acesso dela e derruba toda a integração. Combinar horário, trocar no
   Conexos, atualizar no Render, redeploy, e validar com uma leitura (`/api/sispag/painel`)
   antes de encerrar a janela.
4. **`AUTH_JWT_SECRET`** — por último, porque invalida todas as sessões ativas. Gerar
   (`openssl rand -base64 48`), atualizar no Render, redeploy. Todo mundo faz login de novo.

## 3. Depois da rotação

- [ ] Nenhum dos quatro valores novos foi copiado para nenhum `.env` local.
- [ ] O `.env` local do Yuri (e de qualquer outra máquina) foi reescrito com:
      `CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api`,
      `databaseConnectionString` do Postgres em container (`npm run dev:local`),
      `AUTH_JWT_SECRET`/`ADMIN_PASSWORD` de teste.
- [ ] Se algum dev precisa mesmo ler PRD para conferir tela: mantém só
      `CONEXOS_BASE_URL` de PRD + credencial de leitura, nunca os outros três.

## 4. O que o código já faz (não substitui a rotação)

Dois pisos foram adicionados no mesmo PR. Eles reduzem o dano de um `.env` mal configurado;
não reduzem o dano de um segredo vazado — por isso a rotação continua sendo P0.

- `BootMigrator` recusa aplicar DDL quando `environment=local` aponta para um banco remoto
  gerenciado. Foi assim que a migração `0049` chegou à produção sem deploy, via `tsx watch`.
  Escapatória deliberada: `PERMITIR_MIGRACAO_REMOTA=1`.
- `EnvironmentProvider` ignora `CONEXOS_WRITE_ENABLED=true` quando `environment=local` e a
  base é a Conexos de produção — ler PRD continua funcionando, escrever não. Local contra
  `-hml` segue liberado (é o fluxo sancionado de validação). Escapatória deliberada:
  `PERMITIR_ESCRITA_PRD_LOCAL=1`, para go-live assistido.
- `src/backend/.env.example` abre com a regra escrita, em vez de deixá-la só na cabeça de
  quem já sabia.
