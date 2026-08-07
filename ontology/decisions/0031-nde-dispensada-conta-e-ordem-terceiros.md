---
adr_number: 0031
title: Processos POR CONTA E ORDEM DE TERCEIROS (imp021 priVldTipo=2) não geram Nota de Débito Eletrônica — a alocação quita com SN + baixa fin014 e para; a modalidade é lida SEMPRE do imp021 no servidor (nunca do payload do browser) e, se indeterminável, a alocação é BLOQUEADA fail-closed
date: 2026-08-07
status: accepted
type: change
related_entities: [NotaDebitoEletronica, SolicitacaoNumerario, Recebimento]
related_actions: [gerarSolicitacaoNumerario]
related_integrations: [conexos-nde-fiscal, conexos-com299-gerdoc]
supersedes_decisions: []
amends_decisions: [0022, 0024]
---

# ADR 0031: NDe dispensada em processos por conta e ordem de terceiros

**Cliente:** Columbia Trading · **Entrega:** Kavex (created by Clonex) · **Fonte:** regra de negócio
informada pelo Yuri (2026-08-07), com evidência do processo real `3543` (SOVENA, filial 2).
**`entity_changed = true`** — a relação `Recebimento 1—1 NotaDebitoEletronica` vira **0..1**, a ação
`gerarSolicitacaoNumerario` ganha um ramo terminal novo e o enum de `etapa` ganha um valor.

## Contexto

O "Processar" da tela de Recebimentos rodava uma cadeia **incondicional** de sete etapas:

```
SN (com299) → fin014 (borderô/validar/baixa/finalizar) → nota-debito (com297)
  → fiscal (com300) → observações (com131) → homologar (com297) → poll SEFAZ
```

Não havia **nenhum** ramo condicional entre a baixa e a emissão da nota: todo recebimento executado
terminava com uma NDe homologada.

Isso está errado para uma parte relevante da carteira. A Columbia opera **importação por conta e
ordem de terceiros** (`docs/conexos-api/README.md`): importa em nome próprio, mas a documentação
fiscal do repasse sai **em nome do encomendante/adquirente**. Nessa modalidade a Columbia não é a
parte que emite o documento de débito — emitir uma NDe ali é um documento fiscal indevido. E a
homologação com297 é **irreversível**: não há teardown (`business-rules/homologacao-nde-com297.md`,
`ontology/integrations/conexos-com297-homologacao.md`).

O enquadramento fiscal já estava documentado no repo, sem enforcement em código:
`docs/reforma-tributaria/00_fonte_da_verdade_ibs_cbs.md` (art. 12 §2º IV, LC 214/2025 — reembolsos
pagos por conta e ordem ou em nome de terceiros ficam fora da base **desde que a documentação fiscal
seja emitida em nome do terceiro**).

A modalidade sempre esteve **na borda do sistema, mas nunca no fluxo**: `imp021.priVldTipo`
(`1 → PRÓPRIA`, `2 → CONTA E ORDEM`, `3 → POR ENCOMENDA`) já vinha no `fieldList` do
`ConexosCadastroClient` e já era tipado — e **nenhuma linha de código o lia**.

## Decisões

### D1 — A modalidade é lida do `imp021` no SERVIDOR, nunca do payload do cliente

O pré-flight ganha um **gate 0.5** (antes do gate 1 de cadastro) que consulta
`ConexosCadastroClient.listProcessos({ filCod, priCods: [priCod] })` — o ramo `priCods` não filtra
`priVldStatus`, então serve como point-lookup e funciona até para processo fechado. Nenhum método de
client novo foi necessário.

O caminho barato seria trafegar o `priVldTipo` do `GET /transacoes/:txnId/processos` até o corpo do
POST. Foi **descartado**: esta é a chave que liga/desliga a emissão de um documento fiscal
irreversível, e aceitar o valor do browser deixaria um analista suprimir (ou forçar) a NDe pelo
devtools. Mesma doutrina do `assertSnPertenceAoProcesso` (ADR-0027), que valida posse no servidor
mesmo com a rota já amarrando a filial.

**Custo aceito:** um read a mais no `imp021` por clique em Processar. Não cacheamos na v1 — o dado
decide emissão fiscal.

### D2 — Modalidade indeterminável ⇒ `blocked` (fail-closed)

Processo ausente na resposta do `imp021`, `priVldTipo` nulo (processo legado), ou falha do read:
a alocação devolve `blocked` com `motivo` nomeando o campo e o `priCod`, **sem escrever nada** (o
write-ahead nem abre). Falha de transporte (405/404/401/403) cai em `TRANSPORT_ERROR` pelo
`classifyValidatorError` já existente — bug de integração, não veredito de domínio.

Não assumimos "provavelmente é encomenda". O erro desse chute é uma NDe homologada indevida, que não
tem desfazimento; o erro do bloqueio é um analista corrigindo um cadastro. Os dois não têm o mesmo
custo.

### D3 — O gatilho é EXCLUSIVAMENTE `priVldTipo === 2`

Existe um proxy tentador: o serviço já deriva uma "variante" do **nome da configuração de documento**
(`extrairVarianteSn`: `"SOLICITAÇÃO DE NUMERÁRIO - TERCEIROS"` → `TERCEIROS`) para escolher a conta
de rateio. **Não é a mesma coisa** e não entra na decisão: a variante descreve qual config de SN o
processo aceita no com299, e um processo pode ter `priVldTipo = 2` oferecendo apenas a config
`- ENCOMENDA`. Os dois eixos passam a conviver como notas independentes no `motivo` do pré-flight.

### D4 — Terminal próprio no ledger: `quitado-sem-nde`

O ramo settla logo após `fin014-done` com a etapa **`quitado-sem-nde`**, e nunca grava `nd_doc_cod`.
Não é migração: a coluna `etapa` é `TEXT` sem `CHECK` (só `status` tem constraint). O `markSettled`
do repositório passa a aceitar override (`etapa = COALESCE($etapa, 'concluido')`), preservando o
default histórico em todos os call sites existentes.

Reusar `concluido` teria deixado a auditoria sem distinguir "a nota não era devida" de "parou antes
de emitir" — exatamente a pergunta que um auditor faz ao ver `nd_doc_cod IS NULL`.

O resultado da API ganha `ndeDispensada: boolean` + `motivo`, e é **`settled`** (sucesso): neste
ponto a SN existe e a baixa está finalizada, ou seja, o trabalho do numerário está completo.

### D5 — A UI passa a tratar `blocked`, que antes renderizava como "Quitado"

Bug pré-existente que entrou em escopo porque D2 torna `blocked` frequente: o
`AlocarProcessosDialog` só ramificava em `error` e `dry-run`, então `blocked` caía no ramo de
sucesso. Agora `blocked` mostra "Não processado" + `motivo`, mantém o botão Processar (é
reprocessável depois de corrigir o cadastro) e **não consome saldo**. O texto de sucesso, que
prometia "nota de débito gerada" incondicionalmente, passa a dizer a verdade nos dois ramos.

## Consequências

- Processos conta e ordem deixam de receber NDe; nenhum registro em `nota_debito_eletronica`
  (o único write site é a etapa `homologar`, que não roda).
- O pré-flight de ACL do com297 continua rodando nesses processos (leitura de permissões, antes do
  serviço). Inofensivo, mas é ruído: candidato a otimização, não a correção.
- Alocações de processos conta e ordem **já processadas antes desta mudança** têm NDe emitida e
  homologada. Não há teardown fiscal — é fato consumado, a levantar com o cliente. Diagnóstico
  sugerido em `_inbox/nde-indevidas-conta-e-ordem-diagnostico.md`.
- Processo legado com `priVldTipo` nulo passa a travar até o cadastro ser corrigido (D2). Se o volume
  incomodar, vira ADR de exceção — não um `catch` silencioso.

## Alternativas descartadas

| Alternativa | Por que não |
|-------------|-------------|
| Trafegar `priVldTipo` do frontend | Decisão fiscal irreversível não pode depender de valor do cliente (D1) |
| Na dúvida, seguir emitindo a NDe | Preserva a operação ao custo de um documento fiscal indevido e irreversível (D2) |
| Na dúvida, seguir sem emitir | Deixa de emitir NDe legítima em processo próprio/encomenda com cadastro furado, e **silenciosamente** (D2) |
| Usar a variante `- TERCEIROS` da config de SN como gatilho | Eixo diferente da modalidade do processo; casaria e deixaria de casar nos casos errados (D3) |
| Reusar a etapa `concluido` | Auditoria não distingue "não era devida" de "parou antes de emitir" (D4) |
