# Frente IV — Fase 1 (extrato real + processos reais): dívidas e achados

Aberto em 2026-07-30, ao entregar a fatia "créditos do `fin095` + processos do
`imp021`". Ver ADR-0023.

## Dívidas registradas (não implementadas)

| # | Item | Prioridade | Nota |
|---|---|---|---|
| 1 | **Usuário de robô no Conexos** | **P1** | O ERP limita sessões simultâneas por usuário (`LOGIN_ERROR_MAX_SESSIONS`, batido ao vivo durante o desenvolvimento). Cada processo Node faz login próprio, então o cron da ingestão vai competir com o app e com jobs manuais. Provisionar antes de agendar o cron. |
| 2 | **Rename do port `NexxeraGatewayInterface`** | P2 | O `NEXXERA_GATEWAY_TOKEN` não está no caminho da ingestão real (que injeta o `ConexosExtratoClient` direto). Renomear quando houver a segunda fonte (CNAB/arquivo). |
| 3 | **Snapshot persistido dos clientes** | P2 | O `ProcessoProviderConexos` cacheia em memória (TTL 10 min). Com mais de uma instância, cada uma paga o próprio full-scan do `imp021`. Uma tabela populada pelo job de ingestão resolve — mas adiciona migration, repositório e staleness para uma tela ainda em dry-run. |
| 4 | **`moeCod` do processo** | P2 | O `imp021` **não** expõe moeda do processo — só `moeCodConv` (conversão) e `moeCodSeg` (seguro), verificado em produção. O provider assume BRL/790 e marca `moeCodAssumido: true` para a UI avisar. Se algum processo for em moeda estrangeira, a SN sairia com moeda errada. Resolver antes do wire-real. |
| 5 | **Cron do `job:ingest-extratos`** | P2 | O script existe e a entrada de cron está documentada em comentário, mas **não está agendada** (não há scheduler — Express puro). Mesmo estado do `job:ingest-pagamentos`. Depende do item 1. |
| 6 | **Categorias de tesouraria hard-coded** | P3 | `CATEGORIAS_TESOURARIA` (206, 210, 213, 207) veio de medição em produção da filial 1. Se outra filial usar códigos diferentes, o filtro erra. Candidato a virar configuração por tenant. |

## Achados que valem para fases futuras

**`prjCod`, `ctpCod`, `tpcCod` estão no `imp021`.** Hoje o payload da Solicitação
de Numerário manda esses códigos de rateio **zerados** (`items[0].prjCod = 0` etc.),
marcados como placeholder à espera do HAR. A resposta default do `imp021/list`
traz os três campos por processo. Vale confirmar se são os mesmos códigos que o
`com299` espera — resolveria o gap `gerdoc-payload-fields` sem HAR.

**O runbook manual do cliente (docx "telas Conexos") descreve o fluxo de escrita
inteiro**, e ele contradiz a modelagem da Fase 5:

```
com299 → gerar o documento financeiro do adiantamento   (valor = valor ALOCADO)
fin014 → baixa: borderô na mesma conta financeira, referenciando o doc gerado
com297 → NOTA DE DÉBITO → Fiscal → Observações → HOMOLOGAR (NF-e)
```

- **O write de recebível é `fin014`** ("Baixa de Títulos - a Receber"), não `fin010`
  parametrizado. A aposta D2 do ADR-0022 estava errada.
- **A NDe é emitida via `com297`** ("Fiscais de Saída") com
  `Configuração = "NOTA DE DEBITO JUROS E MULTA"`, `Série NFE1`, `Número 0`,
  `CFOP 5922-ND`, `Tipo de Operação = NOTAS DE DEBITO E CREDITO`,
  `Produto 41978 = PAGAMENTO ANTECIPADO`, e termina em **Homologar (NF-e)**.
- **O mesmo modal `COM_068` serve `com299` e `com297`** — o
  `GerDocProcessoSelectionDTOCab` que já existe provavelmente serve para emitir a
  NDe também, mudando a Configuração.
- A ontologia modela `executarRecebimento` como UMA ação atômica. O real são
  **três documentos, três telas, três "finalizar/homologar"** — o write-ahead ledger
  precisa de três pontos de falha parcial, não um.
- **O valor da SN é o valor ALOCADO**, não o valor cru da transação (está escrito
  no runbook). Isso resolve metade do card `fault-tolerance-4`.

⚠️ Os prints do `com297` no docx foram capturados em **PRODUÇÃO**
(`columbiatrading.conexos.cloud`, sem `-hml`), diferente dos de `com299`/`fin014`.
Se o passo foi executado, existe uma nota de débito real de R$ 10.000 (documento
18248, INOX-TECH, 30/07/2026). Confirmar antes de qualquer captura de HAR.

## Perguntas em aberto para o negócio

1. A NDe é emitida **sempre**, ou só quando há juros/multa? O nome da configuração
   é "NOTA DE DEBITO JUROS E MULTA", mas o exemplo do runbook usa o valor cheio.
2. Um crédito que cobre três processos vira **um** documento `com299` ou **três**?
   O modal só aceita um `Processo` — o que sugere um por processo, e isso É o rateio.
3. O `com299` gera o título que o `fin014` depois baixa, ou o `fin014` baixa um
   título que já existia?
