# Regis-Review follow-ups — auth-senha-propria

Gate `--quick` de 2026-10-02 (`docs/regis-review/2026-10-02-1636-auth-senha-propria/`): nota 7.7, **nenhum
P0**. Nada aqui foi implementado nesta feature. Ids entre parênteses = cards do `KANBAN.md`.

- [P1] Limitar a concorrência de POST /me/senha e encurtar o timeout do PUT /user dentro da transação travada (performance-1)
- [P1] Revogar os tokens HS256 do usuário ao trocar a senha no modo local (security-1)
- [P1] Smoke pós-deploy no pipeline, inclusive conferir que as migrations novas foram aplicadas (deployability-2)
- [P2] Verificar automaticamente que "Secure password change" do Supabase está OFF (deployability-1)
- [P2] Corrigir a mensagem AUTH_DIVERGENCIA de senha: o sync-supabase-auth não reconcilia senha; escrever o reparo real (fault-tolerance-1)
- [P2] Contar 503/timeout no limitador de senha e limitar a uma troca em voo por usuário (performance-2)
- [P2] Store compartilhado para o limitador de senha, ou travar instância única no DEPLOY.md (security-2)
- [P2] Logar e alertar rajadas de 422 SENHA_ATUAL_INVALIDA e avisar o dono da conta numa troca (security-3)
- [P2] Pisos de cobertura por arquivo para OwnPasswordService, PasswordPolicy e o limitador de senha (testability-1)
- [P2] Alarme sobre AUTH_DIVERGENCIA e AUTH_INDISPONIVEL (fault-tolerance-2)
- [P2] Fixtures gravadas do GoTrue para PUT /user e logout scope=others, e a sonda de versão na CI (integrability-2)
- [P2] Tirar o ConexosSessionResolver do handler de /me (modifiability-2)
- [P2] Quebrar o UserRepository por responsabilidade quando o próximo tweak o tocar (modifiability-3)
- [P2] Máximo de 72 bytes na criação e no reset de senha pelo admin (S2 do scoping)
- [P2] Evento de auditoria tipo senha no reset do admin, com o ator na assinatura de resetPassword (S2 do scoping)
- [P3] Documentar por que a 0073 não tem reverse e o que fazer num rollback (availability-3)
- [P3] Kill switch de runtime para /me/senha (deployability-3)
- [P3] Distinguir senha recusada pelo GoTrue (weak_password) de indisponibilidade no POST /me/senha (integrability-3)
- [P3] Limites do limitador de senha via EnvironmentProvider (modifiability-1)
- [P3] Medir o custo real do bcrypt e logar a duração da troca (performance-3)
- [P3] Clock injetável no SupabaseAuthClient e dependências injetadas no me.test.ts (testability-3)
