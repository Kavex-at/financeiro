# Shared metrics — run 2026-10-26-1700-sispag-boleto-agrupado

**Escopo:** review REDUZIDO (fault-tolerance, security, integrability, testability) do delta `origin/main..HEAD` da
branch `feat/sispag-boleto-agrupado` (ADR-0077, regra `boleto-agrupado-sispag` I21a–u; migration 0090). Availability,
deployability, modifiability e performance não rodam nesta rodada por escolha de escopo.

## Delta
 182 files changed, 30554 insertions(+), 265 deletions(-)

## Gates (medidos nesta branch, depois do rebase em origin/main b6326240)
- Backend: typecheck 0 erros; jest 305 suites / 5.939 testes verdes; biome 123 warnings (0 erros).
- Frontend: typecheck 0; lint 0 erros / 21 warnings; jest 122 suites / 1.355 testes verdes.
- PatternGuardian: sem violações (conferido por amostragem: sem process.env, sem `!`, sem setTimeout, SQL só com parâmetros nomeados).
- HML (2026-10-26): fase `canonico` 6/6 (borderô 253). `falha`, `retomada`, `v7` e a medição PRD GT1/GT2 PENDENTES.
- Defeito achado pela prova HML e corrigido: `EM_GRUPO` tratado como "boleto sem DDA" (commit 6aa8aa08).

## Onde olhar
Serviços: `src/backend/domain/service/sispag/{GrupoBoletoService,BorderoGrupoBoletoService,RemessaService,FechamentoGrupoBoleto,CasamentoRetornoGrupo,RetiradaCodigoBarrasService,MotorGrupoBoleto,RegraGrupoBoleto,SituacaoPagamentoResolver}.ts`;
repositórios `GrupoBoletoRepository`, `GrupoBoletoExecucaoRepository`; clients `ConexosBaixaClient`, `ConexosSispagWriteClient`;
rotas `routes/sispag.ts`; migration `migrations/0090_sispag_grupo_boleto.sql`; frontend `src/frontend/app/sispag/components/{GrupoBoletoPainel,ComporGrupoBoletoDialog,GrupoBoletoLinha}.tsx`;
regra `ontology/business-rules/boleto-agrupado-sispag.md`; decisão `ontology/decisions/0077-sispag-boleto-agrupado-bordero.md`.
