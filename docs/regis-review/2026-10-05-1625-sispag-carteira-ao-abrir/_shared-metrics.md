# Métricas compartilhadas — sispag-carteira-ao-abrir (escopo restrito ao delta, `--quick`)

Caminhos reais: `src/backend`, `src/frontend` (não `backend/src`). Não existe `infra/`: toda métrica de
Terraform/tenant é **não medível**. O delta de revisão são os commits `74bdfe5` (backend), `0c6b649`
(frontend) e `f25c7e6` (workflow + docs) sobre `0f35224`. Os commits anteriores da branch (G-02..G-05,
G-13, diálogo DDA, flag de boleto) já foram revisados em outra sessão e ficam fora do escopo.

## Delta (20 arquivos, +854 / −10)

Backend: `domain/service/sispag/CarteiraAtualizacaoService.ts` (114 LOC, novo) + `.test.ts` (151);
`routes/sispag.ts` (+20, rota `POST /sispag/carteira/atualizar`); `domain/libs/environment/EnvironmentProvider.ts`
(+10) e `model/EnvironmentVars.ts` (+14): `sispagCarteiraTtlMin`, `sispagCarteiraCooldownMin`, `readMinutos`;
testes de rota, de permissão e de ambiente.
Frontend: `app/sispag/useCarteiraAoAbrir.ts` (78 LOC, novo) + `.test.ts` (72); `app/sispag/page.tsx` (+22);
`lib/sispag.ts` (+34); `IngestaoDialog.tsx` (+8); `page.test.tsx` (+89).
CI: `.github/workflows/ingest-sispag.yml` (duas entradas de schedule; formação condicionada a
`github.event.schedule == '0 10 * * *'` ou `workflow_dispatch`).
Docs: ADR-0060, `ingerir-pagamentos.md`, `staleness-por-pipeline.md`, `ontology/CHANGELOG.md`.

## Baselines medidos nesta sessão (2026-10-05)

- Backend: `npx jest` completo = **198 suítes / 3644 testes**, todos passam. `npm run typecheck` limpo.
  `npm run lint` (biome): 0 erros, 78 warnings (baseline do repo).
- Frontend: `npx jest app/sispag lib` = **16 suítes / 197 testes** passam. `npm run lint`: 0 erros,
  3 warnings. Typecheck: 1 erro preexistente fora do escopo (`@radix-ui/react-dropdown-menu` ausente).
- Ingestão: **~9 s** medidos no log do cron de 04/10 (7 filiais, ~1,4 mil títulos; 15:02:40 → 15:02:49 UTC).
- Cron do GitHub atrasa 2–5 h: a ingestão agendada para 07:00 BRT saiu entre 11:29 e 13:48 BRT.
- Reaper (cron pedido a cada 15 min) rodou a cada ~3–6 h entre 04/10 e 05/10.

## Fatos do desenho que os agentes devem conhecer

- A rota nova exige `sispag:ver` e escreve só no Postgres próprio; lê o Conexos (I1: nenhuma escrita no ERP).
- A ingestão usa advisory lock (`IngestLockBusyError`), run auditada em `pagamento_ingestao_run` e
  anti-fantasma por filial lida. O refresh é **síncrono** (~10 s), por compatibilidade com o alvo Lambda.
- TTL 30 min e cooldown 5 min vêm de `EnvironmentProvider` (`SISPAG_CARTEIRA_TTL_MIN`,
  `SISPAG_CARTEIRA_COOLDOWN_MIN`); valor inválido ou ≤ 0 cai no default.
- A formação de lotes NÃO roda na abertura da tela (decisão 4 do ADR-0060).
- O robô (CLONEX) recebe 403 em `fin015/finItemSispag/titulosPendentes` (FIN_041); o flag de boleto
  ilegível agora preserva o valor gravado (commit anterior, fora do delta).
