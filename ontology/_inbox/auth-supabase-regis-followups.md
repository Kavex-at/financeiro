# Follow-ups — auth-supabase (ADR-0054)

Não implementados nesta feature. Origem indicada em cada bloco.

## ObservabilityAdvisor (Task 12, 2026-09-30)

- [P2] Logar a recusa do refresh pelo GoTrue (`SupabaseSessionService.refresh`) como `AUTH_SESSAO` warn com o motivo, para medir a taxa de sessões derrubadas
- [P2] Trocar o `console.warn` do 403 em `http/acesso.ts` (`exigirPermissao`) por `LogService.warn` estruturado, buscável junto dos outros eventos de acesso
- [P3] Trocar o literal `'BUSINESS_ERROR'` do login ambíguo (`AuthService` e `SupabaseSessionService`) por uma constante de `LOG_TYPE`
