# Regis-Review (reduzido) 2026-10-20-1140 — métricas compartilhadas

> Escopo: delta da branch `worktree-sispag-dda-ordem-dps` contra `origin/main` (v0.69.0), tweak
> `sugestao-boleto-dda` (ADR-0073; I15p — âncora DPS). Worktree:
> `/home/inteli/Área de trabalho/projects/kavex/financeiro/.claude/worktrees/sispag-dda-ordem-dps`
> (use SEMPRE caminhos dentro dele; o checkout principal está defasado). Delta = `git diff origin/main HEAD`
> (41 arquivos, +3,1 mil linhas, maioria testes e ontologia).

## O que muda
1. **Âncora DPS no motor de sugestão** (`RegraSugestaoBoleto`, `AncoraOrdemDps`, `MotorSugestaoBoleto`): o
   emissor de NFS-e (MULTILOG) numera o boleto DDA como `<DPS>000`. Sinais `DPS_IGUAL` (DPS lido do PDF) e
   `ORDEM_DPS` (k-ésimo título por NFS-e × k-ésimo boleto, só em escopo (credor, emissor) provado por um
   DPS lido; qualquer dúvida = sem âncora). Âncora DPS reserva o boleto antes das outras camadas; não sobe
   tier, não alarga limite; a analista continua confirmando.
2. **Tabela `titulo_dps`** (migration 0087, aditiva, CHECKs) + `TituloDpsRepository` (Zod na leitura).
3. **Leitor do GED** (somente leitura no Conexos): `ConexosGedClient` (`psq014` → `arq020/TelaDocumento/list`
   → `arqDocFiles/list` → `arqDocFiles/download`, que devolve string JSON com o PDF em base64);
   `authenticatedGetBinary` novo em `services/conexos.ts` (+ adapter, `ConexosBaseClient.getBinary`);
   `ExtratorTextoPdf` (`pdfjs-dist@4.10.38`, import dinâmico, `isEvalSupported:false`, máx. 5 páginas);
   `LeituraDanfse` (rótulo → valor por posição); `SelecaoLeituraDps` (AMBIGUA/SO_FRACA/DISPUTADA com
   candidato N000; sem reler LIDO; falha relê após 12 h, máx. 3); `LeitorDpsService` (grava LIDO/SEM_PDF/
   SEM_DPS_NO_PDF/ERRO; NFS-e do PDF ≠ do título = ERRO; falha de um título não para os outros).
4. **Job `ler-dps-nfse`**, último passo do cron `ingest-sispag.yml` (3×/dia); exit 1 só se tudo falhou.
5. Frontend: 2 sinais novos no enum fechado + rótulos (DesignSystemReviewer APROVADO).

## Baselines (rodados pelo orquestrador — NÃO rode de novo)
- Backend: typecheck OK; lint 0 erros (101 avisos, só 1 novo: script de validação one-off); jest 264 suites
  / 4878+ testes verdes.
- Frontend: typecheck 0; lint 0 erros; jest 101 suites / 1069 testes.
- PatternGuardian (etapa 1): PASS, 0 P0. DesignSystemReviewer: APROVADO.
- Desempenho do motor (fora do jest, 1,1k títulos × 1,5k boletos): branch 134 ms vs main 152 ms.
- **Validação ao vivo somente leitura em PRD:** com 1 DPS lido em memória, só 41155/41156 mudam de
  desfecho (SO_FRACA → SO_ATENCAO com o boleto certo), 0 outros credores alterados. Leitor ao vivo: 5/5
  títulos chegam ao download; DPS lidos e iguais ao previsto: 41155→776132, 41156→776138, 10463→25459,
  41087→775530 (layout municipal, após ajuste). 37186 é CT-e (DACTE) sem DPS → SEM_DPS_NO_PDF (correto).
  Bugs achados só ao vivo e corrigidos: `com298/{doc}` não acha documento só financeiro; download em base64.

## Riscos que motivaram a escolha dos QAs
Integração nova e não documentada com o Conexos (Integrability); PDF de terceiro processado no servidor e
dependência nova (Security); job em cron que lê ERP e grava estado (Fault Tolerance); partes só validáveis ao
vivo, `pdfjs` fora do jest (Testability). Pulados: Availability, Deployability, Modifiability, Performance
(cobertos por PatternGuardian, migration aditiva, gate de complexidade do lint e medição acima).

## Fora do escopo
Confirmação automática; provar escopo de CT-e; outros credores além da MULTILOG (a regra é genérica, a prova
é por escopo).
