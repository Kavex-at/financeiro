# sispag-remessa-download-export — follow-ups do Regis-Review

Review: `docs/regis-review/2026-10-06-1500-sispag-remessa-download-export/` (8 QA, modelo sonnet).
**Nenhum P0.** Itens abaixo NÃO foram implementados neste PR, exceto onde marcado.

## Já tratado no PR (P2 apontado por 3 QAs, barato e no código novo)
- [x] **fault-tolerance-1 / integrability-1 / availability-1 (parte):** o fallback por `gabCod` aceitava
  qualquer corpo (`String(raw)` → `"[object Object]"` servido como `.REM`). Agora só aceita conteúdo com
  cara de header CNAB 240 (`/^\d{3}00000/`); fora disso, `RemittanceFileUnavailableError`.

## P2
- [ ] **availability-1 / fault-tolerance-2:** o conteúdo baixado pelo `gabCod` não é conferido contra o
  `remessaNum` do lote (NSA no header CNAB). Avaliar se o `gabCod` é reciclado no fin015 como o `flpCod`.
- [ ] **availability-2:** contar/alarmar fallback por `gabCod` e `REMESSA_ARQUIVO_INDISPONIVEL`;
  confirmar timeout explícito no GET de download do fin015.
- [ ] **security-1:** log do export sem o usuário nem os ids dos lotes — sem trilha de quem exportou
  credor/valor. Incluir `ator` e `loteIds` no `BUSINESS_INFO`.
- [ ] **performance-1:** `listLotes` sem LIMIT/paginação; a aba Finalizados cresce com o tempo.
- [ ] **deployability-1:** frontend (Vercel) pode subir antes do backend (Render) → 404 no export por
  minutos. Mensagem amigável para 404 e ordem de deploy backend→frontend.
- [ ] **testability-1:** rota de export sem teste de 403 e de erro não-domínio → 500.
- [ ] **testability-2:** `listLotes`/`listLotesPorIds` só testados com pool mockado (sem integração Postgres).
- [ ] **modifiability-1:** cinco arquivos tocados já passam de 600 LOC (`RemessaService` 1665,
  `lib/sispag.ts` 1611, `routes/sispag.ts` 1206, `LoteCard` 1167, `LotePagamentoRepository` 1087).

## P3
- [ ] **performance-2 / integrability-3:** ir direto ao `gabCod` registrado quando existir (hoje: grade
  primeiro, até 2 chamadas seriais ao Conexos).
- [ ] **performance-3 / fault-tolerance-3:** export em memória; logar `durationMs`/bytes; lazy-import do exceljs.
- [ ] **availability-3:** teto de 50 lotes, mas não de títulos.
- [ ] **availability-4:** falha no `logService.info` após montar a planilha devolve 500 e perde o arquivo.
- [ ] **security-2:** `remessaArquivo` (vindo do Conexos) vai cru no `Content-Disposition` do download;
  sanitizar como o export faz.
- [ ] **security-3:** teste que guarde contra fórmula/CSV injection se o export mudar de formato
  (hoje exceljs grava string como célula de texto — não explorável).
- [ ] **integrability-2:** `MAX_LOTES_EXPORT`/`STATUS_COM_REMESSA` duplicados à mão backend↔frontend.
- [ ] **modifiability-2/3:** writer XLSX compartilhado com Permutas; `OFFSET_BRT_MS` duplica o
  `BankingCalendar`.
- [ ] **testability-3:** fixture gravada da resposta do fin015 para o fallback por `gabCod`.
- [ ] **deployability-2:** sem flag/rollout gradual para features SISPAG (risco baixo: read-only).
