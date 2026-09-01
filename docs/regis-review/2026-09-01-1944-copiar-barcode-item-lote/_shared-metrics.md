# Métricas compartilhadas — run 2026-09-01-1944-copiar-barcode-item-lote

> Escopo: **delta** da feature `copiar-barcode-item-lote` (`--quick`). Branch
> `feat/copiar-barcode-item-lote`, base `main` d70088e.
> Repo usa `src/backend/` e `src/frontend/` — **não** `backend/src/`.

## Delta (git diff main --stat)
```
 .../domain/client/ConexosSispagWriteClient.test.ts | 70 ++++++++++++++++++++
 .../domain/client/ConexosSispagWriteClient.ts      | 71 ++++++++++++++++++++
 .../service/sispag/SispagPainelService.test.ts     | 76 +++++++++++++++++++++-
 .../domain/service/sispag/SispagPainelService.ts   | 41 ++++++++++++
 src/backend/routes/sispag.test.ts                  | 42 ++++++++++++
 src/backend/routes/sispag.ts                       | 19 ++++++
 src/frontend/app/sispag/components/LoteCard.tsx    | 62 ++++++++++++++++--
 src/frontend/app/sispag/page.tsx                   |  2 +-
 src/frontend/lib/sispag.ts                         | 19 ++++++
 9 files changed, 396 insertions(+), 6 deletions(-)
```

## LOC do backend por camada (fonte, sem testes)
```
domain/service: 14855
domain/repository: 5503
domain/client: 7342
domain/libs: 1496
routes: 2614
http: 721
```

| Métrica | Valor |
|---|---|
| Testes backend (arquivos) | 128 |
| Testes frontend (arquivos) | 25 |
| LOC frontend (fonte) | 17850 |
| Deps backend (prod+dev) | 16+14 |
| Deps frontend (prod+dev) | 23+17 |
| Módulos Terraform | ⚠️ **Não medível**: não existe `infra/` neste repo (deploy via Render hook) |
| Tenants provisionados | ⚠️ **Não medível**: sem Terraform/tenants |
