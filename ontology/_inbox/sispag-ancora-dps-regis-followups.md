# Follow-ups do Regis-Review 2026-10-20-1140 — âncora DPS (ADR-0073)

Gate passou sem P0. Itens abaixo NÃO foram implementados no ciclo (Inviolable Rule #11). Relatório:
`docs/regis-review/2026-10-20-1140-sispag-ancora-dps/REPORT.md`. Ordem = prioridade sugerida.

| # | P | Origem | Item | Onde |
|---|---|--------|------|------|
| 1 | P2 (duplo) | Security F-2, Fault Tolerance F-2 | Não gravar `LIDO` sem cruzar a NFS-e: exigir nº da NFS-e no PDF igual ao do título (ou no nome do arquivo) e, sem conferência, gravar `SEM_DPS_NO_PDF` com motivo; dar um jeito de invalidar um `LIDO` errado | `LeitorDpsService.ts` (`ler`, `escolherPdf`) |
| 2 | ~~P1~~ **feito no PR #127** | Fault Tolerance F-1 | `dpsRepo.listarLidos()` com `.catch` → `[]` + log de aviso no `sugerirAgora`: DPS é sinal auxiliar, não pode derrubar a lista de sugestões | `BoletoSuggestionService.ts` |
| 3 | P1 | Integrability F-1/F-3 | Contrato quebrado não pode virar `SEM_PDF` em silêncio: logar o `catch` do `psq014`, contar descartes de Zod/envelope, e sinalizar no job (exit/alerta) quando a taxa de `ERRO`/descarte passar de um limiar | `ConexosGedClient.ts`, `ler-dps-nfse.ts` |
| 4 | P1 | Testability F-1 | Teste de CI do `ExtratorTextoPdf` (PDF sintético; jest com `--experimental-vm-modules` ou extrator em subprocesso) | `domain/libs/pdf/` |
| 5 | P2 | Fault Tolerance F-3, Integrability F-5 | Transiente (401/5xx/sessão) não consome tentativa; `RetryExecutor` nas chamadas do GED | `LeitorDpsService.ts`, `ConexosGedClient.ts` |
| 6 | P2 | Integrability F-2 | Conferir `%PDF-` depois do base64 e `binNumSize` antes do parse | `ConexosGedClient.baixarArquivo` |
| 7 | P2 | Security F-1 | Teto de bytes/tempo para o download e o parse | `services/conexos.ts`, `ExtratorTextoPdf.ts` |
| 8 | P2 | Testability F-2/F-3 | Decisão de exit do job como função pura testada; fixtures (anonimizadas) dos layouts reais | `jobs/ler-dps-nfse.ts`, testes |
| 9 | P2 | Integrability F-4 | Layout por emissor/município em vez de regex única; distinguir CT-e de layout desconhecido | `LeituraDanfse.ts` |
| 10 | P3 | Security F-3 | Parser fora do passo de CI que tem os segredos de produção; gate de CVE (Dependabot/`npm audit`) | `.github/workflows/` |
| 11 | P3 | Fault Tolerance F-4 | Timeout próprio do passo; não reler `SEM_DPS_NO_PDF` determinístico (CT-e) | `ingest-sispag.yml`, `SelecaoLeituraDps.ts` |
| 12 | P3 | Testability F-4 | Testar falha do download/extrator e o `log.warn` | `LeitorDpsService.test.ts` |

Também em aberto (não é achado de QA): provar o escopo de emissores de CT-e (sem DPS no PDF) — hoje a ordem fica
dormente ali, por desenho.
