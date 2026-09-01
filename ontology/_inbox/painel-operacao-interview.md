# OfficeHours — Painel de Operação (Frente transversal / Módulo 6)

> Modo: `new`. Conduzida em 2026-09-01. Origem: revisão de produto das telas de Permutas e
> Recebimentos (ver `docs/impacto/h0-recebimentos-achados.md` e `h1-permutas-achados.md`).
> `entity_changed = true`.

## Intent

O sistema executa bem e **não sabe dizer que está executando**. Quatro crons alimentam as três
frentes; nenhum avisa quando falha. A configuração que decide o comportamento de negócio vive em
env vars invisíveis, e duas delas já produziram defeito visível em produção. Este slice dá ao
sistema uma superfície de operação: trilha de execução, diagnóstico de configuração e alerta.

## Axis 1 — Entity

### `JobRun` (read-model, NÃO tabela nova)

**Decisão (Yuri, 2026-09-01):** read-model sobre as três tabelas existentes, com um adapter por
fonte normalizando para uma forma comum. Sem migration, sem tocar nos três writers, risco zero
para pipelines que movem dinheiro.

Fontes e suas divergências reais:

| Fonte | Tabela | Vocabulário de status | Métricas próprias |
|---|---|---|---|
| Permutas (eleição/ingestão) | `permuta_snapshot` runs | — | elegíveis / bloqueadas |
| Recebimentos (extratos) | `recebimento_ingestao_run` | `running/success/partial/error` | lidas / inseridas / deduplicadas / contas falhas |
| SISPAG (pagamentos) | `pagamento_ingestao_run` | `running/success/error` (**sem `partial`**) | títulos / inativados |

`partial` existe só em recebimentos, e por decisão deliberada (o painel usa a última run `success`
para dizer "carteira de HH:mm" com honestidade). O read-model **preserva** essa distinção — não
achatar `partial` em `success`, que apagaria justamente o sinal das 5 runs com 77 contas falhas
que ninguém investigou.

### `Alerta` (entidade nova, persistida)

Persistida porque alerta precisa de **deduplicação**: um staleness que dispara a cada rodada do
detector vira ruído e ensina o time a ignorar o canal. Chave de dedup por `(tipo, alvo, janela)`.
Persistir também é o que permite o próprio painel ser um sink (ver Axis 4).

### Config doctor — **não é entidade**

É um manifesto em código (quais env vars cada frente exige vs. usa opcionalmente) + uma leitura
do ambiente. Nada a persistir. Não entra na ontologia como entidade.

## Axis 2 — Action

| Ação | Descrição |
|---|---|
| `exporOperacao` | Lê o read-model + o diagnóstico de config e monta o painel. **Não toca o ERP** (ver invariante I4). |
| `detectarStaleness` | Compara a idade da última run bem-sucedida de cada pipeline com o limite DAQUELE pipeline. |
| `notificarFalha` | Emite um `Alerta` por um `AlertSink`, com dedup. Best-effort. |
| `validarConfiguracao` | Roda no boot e sob demanda; classifica cada var em `configurado / ausente / usando default`. |
| `reconciliarNdeSefaz` | Move `hidratarNdes` do browser para job (follow-up F1). Primeiro consumidor real da plumbing nova. |

## Axis 3 — Invariant

- **I1 — Alerta não se repete.** Mesmo incidente não gera segundo alerta dentro da janela de dedup.
- **I2 — Limite de staleness é POR pipeline.** Um único limite global estaria errado para todos:
  extratos roda de hora em hora (`20 * * * *`), permutas 3×/dia (`0 9,15,21 * * *`), SISPAG diário
  (`0 10 * * *`), reaper a cada 15min (`10,25,40,55 * * * *`).
- **I3 — O config doctor NUNCA imprime valor de secret.** Só `configurado / ausente / default`.
- **I4 — O painel não depende do ERP.** É a tela que se abre quando o Conexos está fora; se ela
  precisar do Conexos para renderizar, ela falha exatamente quando é necessária.
- **I5 — Alerta nunca derruba um job.** Best-effort, como o `LogService` já é hoje.
- **I6 — Staleness é computado no read-model, não só no cron.** Consequência direta de aceitar o
  detector em GH Actions (Axis 4): se o detector não rodar, o painel ainda mostra a verdade ao ser
  aberto. O cron *alerta*; o painel *sempre sabe*.

## Axis 4 — Integration

### Canal de alerta — `AlertSink` (port)

**Decisão (Yuri, 2026-09-01):** *"I like option two via Email, but this can't be a block, the email
feature requires access that is harder to get. (…) we may deliver this later."*

Resolução: port `AlertSink` com dois adapters.

1. **`DbAlertSink` — entra neste slice.** Persiste o `Alerta`; o próprio Painel de Operação o
   exibe. Alerting funciona no dia 1, sem credencial nenhuma.
2. **`EmailAlertSink` — atrás de config, entra quando o acesso existir.** Ligar é um flip de
   configuração, não uma reescrita. Vendor não é decidido agora (evita decisão prematura).

Não existe infra de e-mail na `main` hoje — confirmado: `feat/email-dispatch-nde` está totalmente
mergeada e não deixou código de envio; nenhuma dependência de mail nos `package.json`.

### Detector de staleness — GH Actions cron

**Decisão (Yuri, 2026-09-01):** quinto workflow em GH Actions.

**Limitação aceita e documentada:** o detector é cego ao cenário em que o próprio GH Actions para
de disparar — que é um dos modos de falha reais (schedules do GH são best-effort e podem atrasar
ou ser descartados). Mitigação parcial via I6: o painel computa staleness ao ser aberto, então um
humano vê a verdade mesmo numa janela em que o detector não rodou. Um dead-man's switch externo
(pinger sobre `/health/pipelines`) fica registrado como follow-up, não neste slice.

## Escopo

**Dentro:** read-model de runs + tela; config doctor (boot + painel); `AlertSink` + `DbAlertSink` +
detector de staleness/falha em GH Actions; mover a reconciliação SEFAZ para job (F1, e F3 sai de
graça).

**Fora:** substituir GH Actions por scheduler real; `EmailAlertSink` ligado; pinger externo;
qualquer mudança nos três writers de run.
