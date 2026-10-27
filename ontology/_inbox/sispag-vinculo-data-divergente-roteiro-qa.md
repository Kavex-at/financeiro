# Roteiro de QA manual — data divergente (Fase 1: confirmar, faixa, filtros)

Ambiente: tenant de desenvolvimento/HML, usuário com `sispag:executar`. **Não** ligar
`SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS` (Fase 2 não existe): nada aqui grava código de barras.

## Preparação
Escolher (ou forjar no banco de HML) quatro títulos "boleto sem DDA" com par DDA de **valor igual**:
- **A:** boleto vence **depois** do título em 7 dias.
- **B:** boleto vence **antes** do título (Δ = −2) e ainda não venceu hoje.
- **C:** boleto vence **hoje**, título vence daqui a 5 dias.
- **D:** boleto venceu **ontem**, título ainda a vencer, par com âncora (número igual ou par vigente).

## Casos
1. **Confirmar A (Δ +7):** abre o diálogo "Boleto com data divergente do título", mostra valor e "+7 dias". Botão Confirmar desabilitado até marcar o checkbox **e** o motivo ter ≥ 10 caracteres. Foco inicial no motivo. Esc fecha sem gravar.
2. **Confirmar B (Δ −2):** o diálogo é o mesmo (substitui o aviso simples). Após confirmar, a decisão fica `CONFIRMADA` com o reconhecimento gravado.
3. **Erro 422 desatualizado:** com o diálogo aberto, alterar o boleto/valor no banco e confirmar. A mensagem do servidor aparece **dentro** do diálogo, que continua aberto, e a lista recarrega ao fundo.
4. **Faixa "bloqueados vencem hoje":** o título C aparece com "Boleto sugerido vence hoje · título vence dd/mm" e entra na contagem e no valor da faixa. Em título com 2+ candidatos seguros, mostra "N candidatos" com o prazo do mais cedo.
5. **Perdido (D):** aparece na região "Perdido: resolver no portal do banco", sem botão, **fora** da contagem de "vencem hoje", e no filtro "Vencidos". Não ganha o motivo `VENCIDO`.
6. **Filtro de/até:** filtrar pelo dia do boleto de B traz o título B; filtrar pelo dia do título também o traz. A linha mostra as duas datas.
7. **Candidato fraco (sem âncora):** não puxa o título para a faixa nem vira "perdido".
8. **Regressão:** par de valor igual, Δ entre 0 e 5, sem divergência: confirma sem pedir ack, como antes. Título sem boleto candidato: prazo = vencimento do título.
9. **Anular e reconfirmar:** anular a decisão de B e confirmar de novo pede novo ack.

## Critério de aceite
Nenhum caso grava escrita no Conexos. Conferir no log do servidor: zero `PUT`/`importar`/`fin070`/`fin026` durante o roteiro.

## Execução 2026-10-27 (v0.76.0, PR #132)

Ambiente: backend + frontend locais (`DEV_AUTH_BYPASS`, ator `dev-bypass`), banco local
`sispag_qa_forge_probe` (carteira e pool DDA de HML ingeridos, `CONEXOS_WRITE_ENABLED=false`,
`CONEXOS_DRY_RUN=true`, `SISPAG_LIVE_WRITE_ENABLED=false`, sem `SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS`).
**HML não tem casos reais**: os 6 títulos "boleto sem DDA" de HML não têm boleto DDA de valor igual e o pool
de HML vai de 11/2025 a 01/2026. Os cenários foram **forjados no banco local** (script
`forge-qa-divergente.sql` do scratchpad da sessão): A = 836/1 (+7), B = 838/1 (−2, lote rascunho com débito
28/10), C = 844/1 (boleto hoje, título 03/11, lote rascunho com débito 27/10), D = 839/1 (boleto venceu
26/10), regressão = 840/1 (+4), fraco = 841/1, dois candidatos = 845/1. Os boletos forjados receberam barra
sintética válida (`CodigoBarrasSintetico`), sem a qual a confirmação para em "não tem código de barras válido".

| Caso | Resultado | Evidência |
|---|---|---|
| 1. Diálogo de A (+7) | **OK** | Título, valor e "+7 dias"; Confirmar desabilitado com só o motivo (9 car.) e com checkbox + 9 car.; habilita com checkbox + ≥10; foco inicial no motivo; Esc fecha sem gravar (0 decisões no banco). |
| 2. Confirmar B (−2) | **OK no servidor, FALHA na tela** | Mesmo diálogo (substitui o aviso simples). `POST confirmar → 201`, decisão `CONFIRMADA` com `reconhecimento_tipo=DATA_DIVERGENTE`, `reconhecido_por=dev-bypass`, Δ visto −2. Mas a tela mostra erro Zod cru (`invalid_value … decisao.sinais[5]`): o backend grava o sinal `DATA_DIVERGENTE_RECONHECIDA` (`SugestaoBoleto.ts:80`), ausente de `SINAIS_SUGESTAO_BOLETO` (`frontend/lib/sispag.ts:2289`) e de `TEXTO_SINAL` (`sugestaoBoleto.ts`). **P0**: toda confirmação com reconhecimento tipado parece ter falhado. |
| 3. 422 desatualizado | **OK, com ressalva** | `UPDATE boleto_dda SET vencimento='2026-11-05'` com o diálogo aberto ⇒ `422 RECONHECIMENTO_DE_DIVERGENCIA_DESATUALIZADO` ("agora a diferença é de +6 … você reconheceu +7"), mensagem **dentro** do diálogo, que fica aberto; `GET /sugestoes-boleto` recarrega ao fundo; nada gravado. **Ressalva:** o painel e a linha continuam com +7/06/11 até recarregar a página, e reabrir o reconhecimento pelo mesmo painel repete o 422 (fail-closed, mas sem saída para a analista). |
| 4. Faixa "vencem hoje" | **OK (parcial)** | C aparece com "Boleto sugerido vence hoje · título vence 03/11", na contagem e no valor (R$ 233,03). Subcaso "N candidatos": **não coberto** (o forjado 845 tem dois candidatos, mas vencem 05/11 e 06/11, fora do dia). |
| 5. Perdido (D) | **OK** | Região "Perdido: resolver no portal do banco", sem botão, fora da contagem de "vencem hoje"; aparece no filtro "Vencidos"; motivo segue "Boleto sem DDA" (não `VENCIDO`). |
| 6. Filtro de/até | **FALHA (metade)** | De/até = 28/10 (dia do boleto de B) traz B, e a linha mostra as duas datas. De/até = 30/10 (dia do título) **não** traz B (6 resultados, sem o 838): `filtrosAbas.ts` usa só `diaDoPrazo(t)`. |
| 7. Candidato fraco | **OK** | 841 sem linha de prazo, fora da faixa e não "perdido". |
| 8. Regressão | **OK** | 840 (+4, valor igual) confirma direto, sem diálogo, `201`, sem campos de reconhecimento. Título sem candidato (536/2): só o vencimento do título. |
| 9. Anular e reconfirmar | **OK no servidor, FALHA na tela** | `POST anular → 200`, decisão `ANULADA`; reconfirmar abre diálogo novo, motivo vazio, checkbox desmarcado, Confirmar desabilitado. A tela do anular mostra o mesmo erro Zod do caso 2. |

**Critério de aceite: atendido.** Nenhum `PUT`/`importar`/`fin070`/`fin026` no log do servidor; as únicas chamadas
ao Conexos foram leituras de HML (`fin015/list`, `fin064/list`); o ajuste de centavos caiu para `shadow`.

**Achados:** (1) P0 — sinal `DATA_DIVERGENTE_RECONHECIDA` ausente do frontend (casos 2 e 9); (2) filtro de/até não
encontra o título pelo próprio vencimento quando o prazo é o do boleto (caso 6); (3) painel desatualizado após o 422
(caso 3); (4) subcaso "N candidatos" do caso 4 sem cobertura.

### Reteste após correção (2026-10-27, mesmo banco)

Correções (frontend): sinal `DATA_DIVERGENTE_RECONHECIDA` em `SINAIS_SUGESTAO_BOLETO` e `TEXTO_SINAL`, com teste de
paridade backend↔frontend (`lib/sispag.sinais.parity.test.ts`); filtro de/até acha o título pelo prazo efetivo **e** pelo
próprio vencimento (`diasDoTitulo`, usado em `filtrosAbas.ts` e `situacaoTitulos.ts`).

| Caso | Resultado |
|---|---|
| 2. Confirmar B | **OK** — `201`, diálogo fecha, painel "Confirmada pelo analista.", nenhum erro na tela. |
| 9. Anular e reconfirmar | **OK** — `anular → 200`, sem erro, o painel volta a oferecer Confirmar. |
| 6. Filtro de/até | **OK** — de/até = 30/10 (dia do título de B) traz o 838 (7 resultados; antes 6). |

Log do servidor no reteste: nenhum `PUT`/`importar`/`fin070`/`fin026`. Pendências: `qa-painel-desatualizado` (caso 3) e o
subcaso "N candidatos" (caso 4) em `sispag-vinculo-data-divergente-regis-followups.md`.
