---
name: transacao-bancaria
type: state-machine
entity: TransacaoBancaria
ontology_version: "0.11"
implementation_status: partial
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/interface/recebimentos/recebimentoTransitions.ts
  - src/backend/domain/repository/recebimentos/TransacaoRepository.ts
  - src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts
  - src/backend/domain/service/recebimentos/normalizarLancamento.ts
  - src/backend/migrations/0047_backfill_status_transacao_por_ledger.sql
last_review: 2026-08-13
states: [importada, conciliada, parcial, manual, erro, processada]
out_of_scope_states: []
---

# Ciclo de vida — `TransacaoBancaria` (movimento bancário — Frente IV) — SKELETON

> **SKELETON (Fase 0).** Modela o estado da conciliação de um movimento bancário importado do
> Nexxera. É estado **local/persistido** (`transacao_bancaria.status`), não do banco/Nexxera. A
> semântica de transição profunda (regras de matching, parcialidade) é modelada nas ações
> (`atribuirBaixa`, Fase 2) — aqui só a **forma** dos estados. Ver `entities/transacao-bancaria.md`.

## Estados (constantes tipadas)

| Constante | Valor | Significado |
|-----------|-------|-------------|
| `importada` | `importada` | Movimento importado e normalizado (estado inicial). Ainda não conciliado. |
| `conciliada` | `conciliada` | Crédito atribuído a recebível(is) com confiança e executado/pronto (match `unica`/`multiplas` resolvido). **SEM WRITER — Módulo 2** (ADR-0034). |
| `parcial` | `parcial` | Σ das alocações EXECUTADAS deste crédito é maior que zero e menor que o valor dele (ADR-0034). Significa **dinheiro já baixado no ERP**, não um palpite de match — resta saldo a alocar. |
| `manual` | `manual` | Match incerto/nenhum → **fila de análise manual** (invariante "sem baixa incorreta"). **SEM WRITER — Módulo 2** (ADR-0034). |
| `erro` | `erro` | A última execução de uma alocação deste crédito falhou (ADR-0034) — reprocessável pela mesma chave de idempotência, que RETOMA pela etapa gravada. |
| `processada` | `processada` | **TERMINAL operacional** (ADR-0033). A alocação foi executada até o fim — SN + baixa `fin014`, com NDe (`concluido`) ou sem ela (`quitado-sem-nde`). As duas contam: a diferença entre elas é FISCAL, não operacional, e quem a carrega é a modalidade. Nada mais a fazer. |

Tipo: `TransacaoBancariaStatus = 'importada' | 'conciliada' | 'parcial' | 'manual' | 'erro' | 'processada'`
(constantes tipadas — nunca strings cruas; princípio P3 da ontologia).

> **Histórico.** Até a ADR-0033 esta máquina **nunca rodou**: não havia caminho de escrita de status,
> nenhuma linha saía de `importada` mesmo com alocações executadas, e o painel mostrava centenas de
> `importada` com baixa já feita no Conexos. A ADR-0033 implementou `TB6`; a **ADR-0034** deu writers
> a `TB3` e `TB5`, ativou a tabela de transições como guarda e fez o backfill da carteira travada.
> `TB2` e `TB4` seguem sem produtor até o Módulo 2 (motor de matching).

## Transições

Cada transição é uma **ação nomeada** com registro de vigência (auditoria). Grava ator/gatilho + timestamp.

| # | De → Para | Ação (gatilho) | Regra | Vigência |
|---|-----------|----------------|-------|----------|
| TB1 | `(novo) → importada` | `importarTransacoesExtrato` | **Implementada** (ADR-0023/0028). Lançamento do `fin095` importado, normalizado, deduplicado por `natural_key`, com correlation id determinístico. Nasce **sempre** `importada` — o `vldConciliado` do ERP não é a nossa conciliação. | 2026-08-04 |
| TB2 | `importada → conciliada` | `atribuirBaixa` (match confiável) | **Sem writer — Módulo 2.** Crédito casa com recebível(is) e é resolvido. | 2026-07-24 |
| TB3 | `{importada,manual,erro} → parcial` | settle do ledger da alocação (`gerarSolicitacaoNumerario`) | **Implementada** (ADR-0034). Escrita quando a execução settla e a **regra Σ** acusa cobertura incompleta: `0 < cents(Σ settled) < cents(valor)`. A origem `erro` existe porque a retomada de uma perna que falhou pode settlar só parte. NÃO propaga falha. | 2026-08-13 |
| TB4 | `importada → manual` | `atribuirBaixa` (incerto/nenhum) | **Sem writer — Módulo 2.** Match incerto/nenhum → fila manual (nunca auto-baixa). | 2026-07-24 |
| TB5 | `{importada,parcial,manual} → erro` | `registrarFalha` da execução; curto-circuito de órfão; varredura de reconciliação | **Implementada** (ADR-0034). Escrita quando uma alocação falha, logo após o `markError` no ledger. Também quando a execução ficou **interrompida** — presa em `reconciling` além da janela: o processo que morre no meio nunca roda o `catch`, então só a varredura (e o backfill) conseguem revelá-la. NÃO propaga falha, e a guarda de origem impede que rebaixe um crédito já `processada` (outra perna do split que fechou antes). | 2026-08-13 |
| TB6 | `{importada,conciliada,parcial,manual,erro} → processada` | settle do ledger da alocação (`gerarSolicitacaoNumerario`) | **Implementada** (ADR-0033, refinada pela ADR-0034). Escrita quando a execução settla nos dois ramos (`concluido` e `quitado-sem-nde`) **e** a regra Σ acusa cobertura total (`cents(Σ) >= cents(valor)`), ou quando a Σ é indeterminada (não regride). Antes da ADR-0034 era escrita por `txn_id` sem somar — o primeiro settle de um split marcava o crédito inteiro. NÃO propaga falha; divergência vira `BUSINESS_WARN`. | 2026-08-13 |

`processada` é terminal de verdade: não sai dele. A garantia é estrutural, não convencional —
`origensPermitidasPara` deriva da mesma tabela e nunca devolve `processada`, e o resultado é aplicado
como `WHERE status = ANY($origens)`.

## A regra Σ (ADR-0034)

`Σ = SUM(valor)` das linhas de `solicitacao_numerario_execucao` com `status = 'settled'` e
`dry_run = FALSE`, comparada com `transacao_bancaria.valor` **em centavos inteiros**.

- `cents(Σ) >= cents(valor)` → `processada` (`>=` porque pagamento a maior é trabalho concluído).
- `0 < cents(Σ) < cents(valor)` → `parcial`.
- **Σ indeterminada** (query falhou, ou o ledger não conhece o `txn_id`) → **não escreve nada**. A
  decisão fica para a varredura de reconciliação, que mede dentro do Postgres numa statement só.
  Escrever `processada` sem ter medido mandaria um crédito com saldo a alocar para o único estado do
  qual não se volta — `origensPermitidasPara` nunca devolve `processada`, então nem a varredura, nem
  o backfill, nem reprocessar o resgatariam.

O filtro por `settled`/`dry_run` é obrigatório: a chave do ledger é
`sn-real:{txnId}:{priCod}:{valor}`, logo somar todos os status contaria duas vezes uma alocação
retentada com valor diferente. Linhas com `valor` nulo (pré-0042) são puladas pelo `SUM`, o que só
pode **subestimar** a Σ — no pior caso um crédito completo fica `parcial` e permanece na fila. Nunca
o contrário.

## `valor` congela fora de `importada` (ADR-0034)

O latch da reingestão (`upsertMany`) só refresca linhas que estão em `importada` **e** não têm
nenhuma linha de ledger. Isso significa que `valor`, `contraparte` e `visto_em_run_id` param de ser
atualizados assim que o crédito recebe qualquer alocação.

Para `processada` é desejável — o passado não deve mudar. Para `parcial` é deliberado: `valor` é o
denominador da regra Σ, e deixá-lo se mexer debaixo de uma alocação em curso trocaria o significado
do rótulo sem que nada tivesse acontecido. Efeito colateral registrado: uma correção de extrato pelo
banco deixa de ser vista nesses créditos.

## O que NÃO escreve status

Um `blocked` de pré-flight (cadastro/elegibilidade reprovados) **não escreve nada** (ADR-0034 D3):
nada foi tentado no ERP, o crédito segue 100% não alocado, e misturá-lo na aba de falhas confundiria
"nós falhamos" com "o cadastro do seu cliente está incompleto" — duas filas com donos diferentes.

## Arquivamento (ortogonal ao status)

`arquivada_em`/`arquivada_por` (ADR-0033) **não** são estados: um crédito arquivado preserva o status
que tinha. Arquivar é um gesto de organização da carteira — tira o crédito da listagem **e dos
KPIs** —, pensado para o ruído de tesouraria (resgate de aplicação, transferência entre contas) que
nunca será conciliado contra processo. Reversível.

> **TB2 e TB4 podem mudar na Fase 2**, quando o motor de matching (`atribuirBaixa`) for modelado a
> fundo. ⚠️ Há uma contradição a resolver então: aqui `conciliada` está definida como match resolvido
> **"e executado/pronto"**, enquanto `actions/recebimentos/atribuir-baixa.md` diz que a mesma
> transição produz "rascunho local, **nenhuma escrita no ERP**". Um estado cujo gatilho não escreve no
> ERP não pode significar "executado". E `parcial` passou a ter, pela ADR-0034, um gatilho
> independente do matching — as duas definições precisarão ser reconciliadas, ou uma delas
> renomeada.

## Relação com o `Recebimento`

A conciliação em si é o agregado `Recebimento` (`state-machines/recebimento.md`, ciclo
`rascunho → aprovado → executado → estornado`). Esta máquina é o **estado do movimento** (o insumo);
a do `Recebimento` é o **estado da conciliação** (o processo). Um crédito `conciliada`/`parcial`
tipicamente tem um `Recebimento` associado.

⚠️ Na implementação atual essa relação ainda **não existe**: o fluxo real de alocação
(`RecebimentoNumerarioService`) nunca cria um `Recebimento` — ele escreve direto no ledger
`solicitacao_numerario_execucao`. O agregado e a tabela `rateio_recebimento` só são escritos pelo
`RecebimentoPipelineService`, que é um coordenador stub. `parcial`, hoje, deriva do ledger, não de
rateio.
