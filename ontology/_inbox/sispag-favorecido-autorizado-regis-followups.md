# Follow-ups — sispag-favorecido-autorizado (Regis-Review 2026-10-08-2012)

Run: `docs/regis-review/2026-10-08-2012-favorecido-autorizado/` (REPORT.md, KANBAN.md e as 8 seções).
**P0: nenhum.** Não implementados nesta feature (regra do gate: só P0 re-entra no loop).

Já resolvidos no próprio ciclo (commit `0f60938`): security-4 (impressões fora das respostas da API) e
performance-1 (página do relatório de candidatos limitada a 25, default 20).
Descartado: integrability P3 "caminho legado de exceção coexistindo atrás de flag" — o código foi apagado.

## P1

| Card | Problema | Melhoria |
|---|---|---|
| deployability-1 | A 0080 apaga 5 tabelas e 8 colunas no boot da instância nova; durante a sobreposição do deploy no Render a instância antiga ainda lê `conferido_por`/`destino_origem`/`excecao_destino_id` e pode responder 500 por segundos/minutos. | Decidir com o Yuri: aceitar a janela (guarda TED/PIX desligada em prod, tráfego baixo) ou fazer expand/contract (drop numa 0081 posterior). |
| modifiability-1 | `RemessaService.ts` chega a 1701 linhas (+29) com a guarda L8 embutida; `gerarRemessaSerializado` tem complexidade 94 (pré-existente). | Extrair a guarda L8 e o pré-voo de destinos para um `RemessaPreflight` injetável. |
| testability-1 | `AuthorizedPayeeService` lê `new Date()` em 6 pontos e os repositórios usam `randomUUID()`; nenhum teste congela o relógio. | Injetar um `Clock` (padrão `BankingCalendar.withClock`) e testar `decididoEm`/`ultimaConferenciaEm`. |

## P2

- **availability-1 / fault-tolerance-4:** falha transitória em `getTituloAPagar` na guarda L8 vira `FALHA_LEITURA` e barra o lote inteiro, descartando a causa (`.catch(() => null)`); logar o status HTTP.
- **availability-2 / performance-2:** leituras da guarda L8 em série no caminho síncrono da remessa (padrão herdado); cache por favorecido entre itens.
- **availability-3:** sem painel/alarme para barramentos da remessa e reaprovações abertas (só o alerta `sispag-destino-alterado`).
- **fault-tolerance-1:** guarda L8 e escrita no ERP não são atômicas — revogação entre as duas não é vista (janela de segundos).
- **fault-tolerance-2:** retomada com lote nativo pula a guarda por decisão (I14g); documentado, sem alerta.
- **fault-tolerance-3:** `finalizarLote` não é atômico: retiradas ficam se a transição falhar depois, e `versao + retirados` supõe nenhum outro bump no meio (um conflito vira 409, nunca finalização indevida).
- **security-1:** segredo HMAC em env do Render, não em SSM; sem procedimento de rotação (recálculo assistido fora de escopo).
- **integrability-1:** `VerificacaoTedPixService` com 9 colaboradores e chamada direta ao `ConexosSispagClient`.
- **integrability-2:** sem fixtures cmn025 (contas, chaves PIX, documento) capturadas para os testes.
- **modifiability-2:** `AuthorizedPayeeService.ts` nasce com ~650 linhas misturando ciclo de vida, verificação e revelação; `routes/sispag.ts` 1147 linhas.
- **testability-2..4:** sem testes de propriedade (fingerprint/máscara), arquivos de teste > 500 linhas, 8 componentes novos sem teste próprio (cobertos via `page.test.tsx`).
- **PatternGuardian P2:** narrowing de `lido.leitura` com `asserts` em `aprovar` (hoje um `throw` inalcançável); type-guard para `error.code` no repositório.
- **DesignSystemReviewer (não bloqueantes):** contraste de `text-warning`/`text-success` em texto pequeno (AutorizacoesTable, SeloConferencia, CandidatosTab, LoteCard); Spinner em vez de Skeleton nas abas; formulários sem react-hook-form + Zod; aba/filtro/página fora da URL; região `aria-live` do "Revelar" montada junto com o conteúdo; radio cru em `SolicitarAutorizacaoDialog`.

## P3

- **deployability-4:** as flags antigas `SISPAG_EXCECAO_DESTINO_ENABLED`/`SISPAG_DESTINO_MANUAL_ENABLED` saíram do `render.yaml` sem ciclo de transição (inofensivo: o código não as lê; apagar no dashboard do Render).
- **security-2:** `revelar` sem rate limit nem alerta de volume.
- **security-3:** `reconferir` (sispag:ver) pode abrir reaprovação — é o comportamento de I14e-4, registrar na ontologia.
- **performance-3:** `AuthorizedPayeeRepository.listar` com `LIMIT 1000` sem paginação; o cache do resolver memoiza leitura que falhou dentro do mesmo fluxo.
- **modifiability-3:** sem ponto de extensão para novas modalidades.
- **testability-5:** sem piso de cobertura próprio para regra/fingerprint/repositório do favorecido.
