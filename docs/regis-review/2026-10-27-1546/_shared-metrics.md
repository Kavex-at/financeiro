# Shared metrics — grouped boleto rejected resend guard

Scope: backend delta in existing feature worktree; --quick, local inspection only. No live ERP, network audit, install, production DB, infra or frontend execution. Express/Render is current; Lambda/Terraform is target only.

Baseline at 2026-10-27 15:46 UTC: typecheck exit 0; backend lint exit 0, 943 files, 124 warnings. Full backend Jest in progress, not yet a passed gate. Focused agent run 278/278 (BorderoGrupo + RemessaService); independent reviewer 74/74 service cases. Fresh final gates will be appended by coordinator after changes.

User-approved contract: before import of old rejected group, require live old-batch item absence, otherwise withdraw all titles with BORDERO_ANTERIOR_NAO_RESOLVIDO + actionable alert; no old lote/bordero mutations. Check orchestration resumes and cleanup; two review findings being corrected (full draft skipped prepare; reused cleanup pending blocked other items). Automatic release is exploration only.

backend: 570 code files / 115280 LOC; 346 test files.
backend dependencies=17, devDependencies=14.
frontend: 213 code files / 40768 LOC; 122 test files.
frontend dependencies=24, devDependencies=17.
src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts: 1585 lines.
src/backend/domain/service/sispag/RemessaService.ts: 2403 lines.
src/backend/domain/service/sispag/RetiradaCodigoBarrasService.ts: 1084 lines.

Terraform module and tenant counts: not measurable; no infra directory. Live latency/availability, ERP post-fix proof, coverage delta: not measured in this quick review.

Read ontology/_inbox/sispag-boleto-agrupado-reenvio-rejeitado-plano.md and -exploracao.md for requirements and evidence. Do not treat mock tests as live ERP proof. Scope findings to this correction; avoid unrelated preexisting debt.

## Final gates after all fixes

- `npm run typecheck`: exit 0 (fresh final run).
- `npm run lint`: exit 0, 943 files, 124 warnings (same count as pre-final baseline; no errors).
- `npm test -- --runInBand`: exit 0, 305 suites / 5979 tests passed, 89.147 s.
- `git diff --check`: exit 0.
- No ERP/production DB calls or new HML execution. HML guard proof remains before-merge blocker.
