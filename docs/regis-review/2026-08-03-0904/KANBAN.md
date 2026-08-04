# KANBAN — Regis-Review `fix/sn-titulo-condicao-fail-closed` (2026-08-03)

> Ordenado por prioridade e, dentro dela, por esforço (S < M < L). Cards marcados ✅ foram
> **remediados nesta rodada**; os demais viram follow-up em
> `ontology/_inbox/sn-titulo-condicao-fail-closed-regis-followups.md`.
> Detalhe completo de cada finding está no arquivo de seção correspondente.

## P0 — crítico

| # | Card | Lente | Esforço | Status |
|---|---|---|---|---|
| 1 | **Tornar visível e freável o ramo de condição de pagamento que não é exercitável em HML.** Problema: o cliente de teste do HML não tem condição sugerida, então a com194 nunca acusa lá — a primeira execução real acontece em produção, sem log distinguível nem forma de desligar. Melhoria: flag `SN_COND_PGTO_AUTOAJUSTE` + log de tipo estável antes da escrita. Resultado: a primeira ocorrência em produção aparece no log e é reversível sem deploy. | deployability | M | ✅ |

## P1 — alto

| # | Card | Lente | Esforço | Status |
|---|---|---|---|---|
| 2 | **Restaurar o invariante das duas chamadas à com194 no teste E2E.** `lastIndexOf` aceitava "alguma chamada depois da homologação"; um refactor podia remover a da etapa da SN em silêncio. | testability | S | ✅ |
| 3 | **Não mascarar erro de transporte da com194 como "sem pendência".** 401/403/404/405 param a etapa; 5xx/timeout seguem best-effort. | fault-tolerance / integrability | S | ✅ |
| 4 | **Bump de versão + tag.** FE e BE em `0.19.0` na base e no HEAD; o job `tag-release` é idempotente por tag, então sem bump não há tag nova e o `/health` mente sobre qual build roda. | deployability | S | ⏳ no fecho do pipe |
| 5 | **Distinguir a falha do fail-closed das demais.** Sem contador/tag dedicada, a divergência HML×produção não se manifesta em métrica — ninguém sabe que o caso bloqueante apareceu até virar chamado. | fault-tolerance | S | ⏳ follow-up |
| 6 | **Fixture HAR versionada da com194.** O regex `/CONDICAO DE PAGAMENTO/` e o `fdvVldErr === 2` vieram de UMA medição; os mocks codificam a mesma. Se o ERP mudar a redação, o gate vira no-op silencioso. | testability / integrability | M | ⏳ follow-up (depende de captura humana) |
| 7 | **Checkpoint intra-etapa no ledger.** A completação roda dentro de um único `if` sem `setEtapa` entre `setDocCod` e `sn-finalizar`; crash no meio deixa documento órfão e a retomada pula passos. Apontado por 3 lentes independentes. | availability / fault-tolerance | L | ⏳ follow-up (muda máquina de estados + migração) |
| 8 | **Runbook da Frente IV.** `docs/runbooks/` só cobre Permutas (`fin010-write-cutover.md`), enquanto a escrita da Frente IV também é irreversível. | deployability | M | ⏳ follow-up |

## P2 — médio

| # | Card | Lente | Esforço |
|---|---|---|---|
| 9 | Instrumentar contagem de chamadas ao ERP por "Processar" — hoje não há contador, então a próxima regressão de latência é invisível | performance | S |
| 10 | Trilha de auditoria do `PUT com299` que troca `pgtCod` (quem/quando/o quê) — hoje só sobra `executado_por` + `request_payload` da geração | security | S |
| 11 | `.gitattributes` normalizando EOL — causa raiz do "lint quebrado" local no Windows (o CI está OK) | deployability | S |
| 12 | Testar os 3 caminhos do fail-closed pós-PUT (hoje só o `título 0 × valor 15000`; faltam zero-zero e parcela parcial) | testability | S |
| 13 | Asseverar o `logService.warn` no teste de com194 indisponível (o padrão já existe no mesmo arquivo) | testability | S |
| 14 | Substituir os `mockResolvedValueOnce` sequenciais, amarrados à ordem interna dos 3 `getDocumento` | testability | S |
| 15 | Limpar as seções OBSOLETAS de `ontology/integrations/conexos-com299-gerdoc.md` (3 banners de correção empilhados + "Posture DRY-RUN") | integrability | S |
| 16 | Documentar a com194 como entrada de integração na ontologia (endpoint, schema, severidade) — hoje é só um bullet num banner | integrability | S |
| 17 | Endurecer `VALIDACAO_ROW_SCHEMA`: todos os campos load-bearing são `optional`/`nullish`, então rename silencioso no ERP passa o parse | integrability | S |
| 18 | Não embarcar `dpeNomPessoa`/`pesCod`/valores nas mensagens de erro que caem em `logService.error` (LGPD/segredo comercial) | security | M |
| 19 | Timeout dedicado para a leitura da com194 na hot path (hoje 40 s compartilhado + 1 retry ⇒ ~80 s de stall sob degradação) | availability | M |
| 20 | Endpoint/caminho de recuperação para a SN em fail-closed (hoje delega ao operador via com032 manual) | availability | M |
| 21 | Extrair `PaymentConditionSelector` — 8 métodos / ~145 LOC / 10% do arquivo, com 2 pipelines de normalização paralelos (`stripAccents` × `normalizarNomePessoa`) | modifiability | M |
| 22 | Reduzir `classificarAlocacao` de complexidade 20 para ≤ 15 (dívida pré-existente) | modifiability | S |
| 23 | Encapsular `EscritaCtx` como cadeia de tipos monotônicos (hoje 2 mutações in-loco mascaram requisito ordinal) | modifiability | M |
| 24 | Escopo do `ConexosNdeFiscalClient.listValidacoes`: a docstring diz "leg fiscal da NDe, pós-homologação", mas agora é gate de SN pré-homologação | integrability | S |
| 25 | Pinar Node (`engines`/`.nvmrc`): CI usa 24, crons usam 22 | deployability | S |
| 26 | Decisão de idioma: formalizar exceção pt-BR no CLAUDE.md **ou** criar `NumerarioMessageMapper` separando canal técnico de canal UX | modifiability | M |
| 27 | `autoDeploy: true` sem stage/canary — aceitável hoje (monotenant), vira P1 com mais tenants ou mais analistas | deployability | M |
| 28 | Correlação de logs: incluir `idempotency_key` em todo warn/erro da etapa | availability | S |

## P3 — baixo

| # | Card | Lente | Esforço |
|---|---|---|---|
| 29 | Guard anti-produção por hostname estrito em vez de substring `/-hml\./` (hoje `...conexos.cloud/api?dummy=-hml.` passaria) | security | S |
| 30 | Cleanup dos artefatos `C:/tmp/*.json` dos testes de integração (contêm estado de doc do HML, incl. `pdcDocFederal`) | security | S |
| 31 | Discriminador do título cobrir decomposição em N parcelas e edição concorrente coerente (hoje `etapaFin014` pega `titulos[0]`) | fault-tolerance | M |
| 32 | Extrair `RecebimentoNumerarioSnEtapa` como classe própria (1400 LOC source + 1128 LOC test numa classe) | modifiability / testability | L |
| 33 | Dividir o serviço em 7 serviços por-etapa — depende do card 21 como piloto | modifiability | L |

## Rejeitados

| Card | Motivo |
|---|---|
| `F-fault-tolerance-3` — "discriminador `docVldFinalizado === 1` nunca implementado" | **Falso.** Implementado em `ConexosGerDocProcessoClient.ts:734,748` (`assertDocumentoFinalizado`). O agente inspecionou só a camada de serviço |
| "Lint quebrado no CI" | **Impreciso.** O CI roda em `ubuntu-latest` com `actions/checkout@v4` (normaliza EOL); a quebra é local no Windows. Vira o card 11 |
