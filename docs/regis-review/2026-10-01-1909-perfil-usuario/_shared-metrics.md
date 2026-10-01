# Shared metrics — perfil-usuario (quick, delta vs origin/main 3cf24c6)

## Delta
 59 files changed, 9257 insertions(+), 66 deletions(-)
```
src/backend/domain/errors/PerfilQueryInvalidError.ts
src/backend/domain/interface/perfil/AtividadeUsuarioInterface.ts
src/backend/domain/interface/perfil/PerfilInterface.ts
src/backend/domain/interface/perfil/PerfilQuerySchemas.ts
src/backend/domain/repository/perfil/AtividadeUsuarioRepository.test.ts
src/backend/domain/repository/perfil/AtividadeUsuarioRepository.ts
src/backend/domain/repository/perfil/PerfilRepository.test.ts
src/backend/domain/repository/perfil/PerfilRepository.ts
src/backend/domain/service/perfil/HistoricoCursor.test.ts
src/backend/domain/service/perfil/HistoricoCursor.ts
src/backend/domain/service/perfil/PerfilService.test.ts
src/backend/domain/service/perfil/PerfilService.ts
src/backend/domain/service/perfil/PeriodoPerfil.test.ts
src/backend/domain/service/perfil/PeriodoPerfil.ts
src/backend/http/routePermissions.test.ts
src/backend/jobs/validate-perfil-usuario-v1.ts
src/backend/jobs/validatePerfilUsuarioIsolation.test.ts
src/backend/migrations/0072_idx_atividade_usuario.sql
src/backend/migrations/0072_idx_atividade_usuario.test.ts
src/backend/migrations/atividadeUsuario.integration.test.ts
src/backend/migrations/rollbacks.test.ts
src/backend/migrations/rollbacks/0072_idx_atividade_usuario.rollback.sql
src/backend/routes/me.test.ts
src/backend/routes/me.ts
src/frontend/app/perfil/AtividadeSection.tsx
src/frontend/app/perfil/HistoricoSection.tsx
src/frontend/app/perfil/IdentidadeSection.tsx
src/frontend/app/perfil/PermissoesSection.tsx
src/frontend/app/perfil/SecaoPerfil.tsx
src/frontend/app/perfil/SegurancaSection.test.tsx
src/frontend/app/perfil/SegurancaSection.tsx
src/frontend/app/perfil/page.test.tsx
src/frontend/app/perfil/page.tsx
src/frontend/app/perfil/periodo.test.ts
src/frontend/app/perfil/periodo.ts
src/frontend/app/usuarios/EditarAcessoDialog.tsx
src/frontend/components/auth/UserMenu.test.tsx
src/frontend/components/auth/UserMenu.tsx
src/frontend/components/ui/avatar.test.tsx
src/frontend/components/ui/avatar.tsx
src/frontend/components/ui/dropdown-menu.test.tsx
src/frontend/components/ui/dropdown-menu.tsx
src/frontend/lib/api/perfil.ts
src/frontend/lib/perfil/senha.ts
src/frontend/lib/permissoes.test.ts
src/frontend/lib/permissoes.ts
src/frontend/package-lock.json
src/frontend/package.json
```
## Delta LOC (non-test src)
```
    17 src/backend/domain/errors/PerfilQueryInvalidError.ts
   260 src/backend/domain/interface/perfil/AtividadeUsuarioInterface.ts
    66 src/backend/domain/interface/perfil/PerfilInterface.ts
    44 src/backend/domain/interface/perfil/PerfilQuerySchemas.ts
   442 src/backend/domain/repository/perfil/AtividadeUsuarioRepository.ts
   119 src/backend/domain/repository/perfil/PerfilRepository.ts
    52 src/backend/domain/service/perfil/HistoricoCursor.ts
   287 src/backend/domain/service/perfil/PerfilService.ts
   162 src/backend/domain/service/perfil/PeriodoPerfil.ts
   464 src/backend/jobs/validate-perfil-usuario-v1.ts
    58 src/backend/migrations/0072_idx_atividade_usuario.sql
    17 src/backend/migrations/rollbacks/0072_idx_atividade_usuario.rollback.sql
   178 src/backend/routes/me.ts
   366 src/frontend/app/perfil/AtividadeSection.tsx
   405 src/frontend/app/perfil/HistoricoSection.tsx
   111 src/frontend/app/perfil/IdentidadeSection.tsx
   117 src/frontend/app/perfil/PermissoesSection.tsx
    80 src/frontend/app/perfil/SecaoPerfil.tsx
   154 src/frontend/app/perfil/SegurancaSection.tsx
    81 src/frontend/app/perfil/page.tsx
    80 src/frontend/app/perfil/periodo.ts
   289 src/frontend/app/usuarios/EditarAcessoDialog.tsx
    78 src/frontend/components/auth/UserMenu.tsx
    42 src/frontend/components/ui/avatar.tsx
    81 src/frontend/components/ui/dropdown-menu.tsx
   161 src/frontend/lib/api/perfil.ts
    80 src/frontend/lib/perfil/senha.ts
   121 src/frontend/lib/permissoes.ts
  4412 total
```
## Repo baseline
- Backend non-test TS LOC: 71683
- Backend test files: 212
- Frontend non-test LOC: 27898
- Frontend test files: 73
- Terraform/infra: não medível — não existe infra/ neste repo
- Backend deps: 16 deps / 14 dev
- Frontend deps: 24 deps / 17 dev
## Gates (measured this session)
- Backend typecheck OK; lint 0 errors / 77 warnings (main 76); jest --coverage 193 suites / 3531 tests passing; SQL integration 36/36 (local PG)
- Frontend typecheck OK; lint 0 errors / 19 warnings (=main); jest 73 suites / 738 tests (app/perfil+components rerun 319/319)
- PatternGuardian PASS; DesignSystemReviewer 1 P1 open (DateFormatter documented but nonexistent); SpecVerifier APROVADO 86/86
- Equivalence vs prod (read-only): 350 comparisons, 0 divergences; EXPLAIN in docs/perfil-usuario/explain.md
