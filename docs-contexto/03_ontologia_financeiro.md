# Financeiro — Ontologia Específica (seed de domínio)

**Versão:** 0.1
**Data:** 2026-06-10
**Status:** documento vivo — narrativa de domínio (ainda não modelada em entidades/ações)
**Cliente:** Columbia Trading · **Área:** Financeiro
**Fonte canônica:** [`docs/proposta/Proposta_Kavex_Columbia_Financeiro.md`](../docs/proposta/Proposta_Kavex_Columbia_Financeiro.md) (e `.pdf`)
**Relação:** complemento de [`03_ontologia.md`](./03_ontologia.md) (seed da plataforma, herdado).

> Este documento dá **contexto e propósito** ao repositório. Ele descreve *o que* o domínio
> financeiro faz, em prosa. A modelagem formal (entidades, ações, regras de negócio,
> máquinas de estado, contratos de integração) é feita incrementalmente via `/feature-new`
> — o `OntologyCurator` popula `ontology/` a partir desta narrativa e das entrevistas.

---

## 1. O que é "Automação Financeira" (Columbia Trading)

A área Financeira da Columbia opera sobre quatro frentes onde o processo **manual** hoje gera o
mesmo tipo de exposição: **dado que não fecha, pagamento que não sai, documento que não
destrava e recebimento que não concilia**. Em cada uma, a perda não fica no operacional — chega à
controladoria como relatório inconsistente, ao caixa como risco de multa e ao fechamento como trava.

O propósito do projeto é a **automação assistida** dessas quatro frentes: o **analista permanece no
controle das decisões que exigem julgamento** e a solução assume o trabalho **mecânico e
repetitivo**. Todas as frentes integram com o ERP **Conexos** (mesmo tenant do
`fechamento-processos`), operam **multi-filial** e registram **trilha de auditoria completa**.

**Princípio operacional (invariante de produto):** *human-in-the-loop*. A solução nunca decide o
que exige julgamento financeiro/comercial; ela prepara, executa o mecânico e audita. O analista
aprova, ajusta e finaliza.

---

## 2. As quatro frentes

### Frente I — Automação de Permutas (Adiantamentos ↔ Invoices)

**Em uma frase:** eliminar o acúmulo silencioso de permutas pendentes entre adiantamentos
(PROFORMA) e faturas (INVOICE), automatizando os casos diretos e assistindo o analista nos compostos.

- **Problema:** o adiantamento pago ao exportador, quando não é reconciliado na cadência
  necessária contra o título na baixa (Conexos `fin010`), fica solto no ERP. Em volume de
  **120–200 permutas/mês** o acúmulo é questão de tempo — e vira relatório que não fecha na
  controladoria. Hoje **não há visibilidade** de quantas estão pendentes.
- **Outcome:** reconciliação em **cadência diária**, backlog de pendências elegíveis **tendendo a
  zero**, controladoria sobre base confiável.
- **Divisão analista × solução:**
  - *Analista:* aprova casos compostos (**N:M**), define a alocação de valores entre proformas e
    invoices, resolve exceções de julgamento.
  - *Solução:* identifica processos com adiantamento pago + INVOICE disponível, calcula a idade da
    pendência, executa permutas diretas (**1:1**) na `fin010` sem intervenção, registra auditoria.
- **Chave de vínculo:** o **número do processo** (a confirmar no diagnóstico).
- **Integração:** Conexos `fin010`.

### Frente II — Automação de Pagamentos (SISPAG)

**Em uma frase:** garantir que nenhum pagamento aprovado deixe de ser executado por falha de
processo — automatizando montagem do lote, envio ao banco e conciliação do retorno no ERP.

- **Problema:** séries de pagamentos deixam de ser executadas porque dar baixa no Conexos é
  trabalhoso e pouco transparente. Pagamento de importação fora do prazo vira **multa, juros ou
  trava** — risco financeiro direto e recorrente.
- **Outcome:** **zero pagamentos perdidos** por falha de processo; lote diário montado, finalizado
  pela analista e conciliado no ERP sem retrabalho.
- **Divisão analista × solução:**
  - *Analista:* revisa o lote candidato, inclui/remove títulos e **finaliza** — a finalização é o
    gatilho que dispara o processamento (mantém a palavra final sobre o que será pago).
  - *Solução:* identifica diariamente títulos a vencer e aprovados para baixa (Conexos `com298`),
    monta o lote, gera a **remessa**, sobe no diretório **Nexxera**, monitora o **retorno** do banco
    e concilia a baixa no ERP. Registra auditoria.
- **Integração:** Conexos `com298` + **Nexxera** (gateway bancário).
- **A confirmar no diagnóstico:** como o status "aprovado para baixa" é representado na `com298`; e o
  **horário de corte** do banco para envio do lote.
- **Dependência de terceiro (crítica):** a **homologação do leiaute bancário (Nexxera)** depende do
  cronograma da instituição financeira — fora do controle da entrega; condiciona os marcos de envio
  e conciliação.
- **Evolução (Fase 2):** monitorar documentos a vencer ainda sem aprovação ("dormindo"), com
  follow-up automático ao responsável.

### Frente III — Popula GED (Documentação de NC/ND)

**Em uma frase:** destravar continuamente as Notas de Crédito/Débito presas em rascunho,
anexando ao GED o documento que as justifica.

- **Problema:** NC/ND nascem em planilha e sobem ao ERP como **rascunho**, mas não podem ser
  baixadas porque falta no **GED** o documento que as justifique. Em **~300 notas/mês**, acúmulo
  constante que **trava o fechamento** e exige upload manual documento a documento.
- **Outcome:** NC/ND destravadas para baixa de forma contínua, sem manuseio manual; o tempo entre
  emissão e disponibilidade para baixa cai de **dias para minutos**.
- **Divisão analista × solução:**
  - *Analista:* apenas supervisiona a **fila de exceções** (PDFs que não casaram). Atuação mínima.
  - *Solução:* detecta o PDF no diretório do **SharePoint**, identifica a qual NC/ND corresponde,
    sobe no **GED** e destrava a baixa. Registra auditoria.
- **Chave de correspondência:** PDF ↔ NC/ND — por **nome de arquivo** (com número da nota) ou por
  **conteúdo** (a confirmar no diagnóstico; calibra a meta de match).
- **Integração:** **SharePoint** (origem) + **GED** (destino).
- **Fora de escopo:** geração da NC/ND (segue no fluxo atual: planilha → rascunho) e a baixa
  contábil em si (a solução **destrava**, não executa a baixa).

---

### Frente IV — Conciliação de Recebimentos (Nexxera ↔ Baixa ↔ NDe)

> **Status:** em modelagem (bootstrap via `/feature-new`, ADR-0022, 2026-07-24). É a **contrapartida
> de entrada** (contas a receber) da Frente II (SISPAG, saída). Ainda não entregue — o skeleton de
> ontologia está em `ontology/entities/{transacao-bancaria,documento-a-receber,recebimento,
> rateio-recebimento,credito-cliente,nota-debito-eletronica,regra-recebimento}.md`.

**Em uma frase:** importar as movimentações bancárias da Nexxera, atribuir cada crédito recebido aos
documentos financeiros em aberto, ratear o valor, aplicar as regras da Columbia e efetivar a
baixa/quitação — culminando na emissão da **Nota de Débito Eletrônica**.

- **Problema:** os créditos que entram na conta (via Nexxera) são conciliados **manualmente** contra
  os documentos em aberto. Sem uma cadência confiável, o recebimento fica sem baixa, o rateio entre
  processos é refeito à mão e a NDe atrasa — virando relatório que não fecha e caixa sem visibilidade.
- **Outcome:** cada crédito importado é atribuído com segurança (ou vai para a fila de exceções), o
  rateio é revisável e auditável, a quitação é idempotente e reversível, e a NDe sai sem retrabalho.
- **Divisão analista × solução:**
  - *Analista:* aprova os casamentos incertos, define/revisa o rateio e resolve exceções.
  - *Solução:* importa e deduplica as transações, propõe o casamento, calcula o rateio, aplica as
    regras (encomenda, adiantamento de cliente, multa/juros), executa a baixa e emite a NDe. Audita.
- **Chave de correspondência:** transação ↔ documento(s) — por cliente/CNPJ, valor, nº do documento,
  referência bancária, nº do processo, vencimento, descrição ou id Pix (calibra a meta de match).
- **Integração:** **Nexxera** (extrato/movimentações — canal **a confirmar**: API ou SFTP/CNAB) +
  **Conexos** (baixa em `fin010`, parametrizada, e emissão da NDe pelo próprio ERP).
- **Fora de escopo (por ora):** a definição fina das regras de negócio (percentuais de encomenda,
  separação de multa/juros) — modelada em fase própria com entrevista dedicada.

---

## 3. Atores e papéis (transversal às frentes)

| Ator | Papel |
|------|-------|
| **Analista (Financeiro)** | Decisão/controle/exceções. Aprova compostos, finaliza lotes, resolve não-matches. |
| **Solução (a aplicação)** | Trabalho automático: identifica, calcula, executa o mecânico, audita. |
| **Conexos / Banco / GED** | Sistemas de resultado onde a ação se materializa (`fin010`, `com298`, remessa/retorno, GED). |
| **Auditoria** | Trilha transversal: toda ação de sistema e de usuário é registrada e persistida. |

---

## 4. Pontos de integração

| Alvo | Uso | Frente |
|------|-----|--------|
| Conexos `fin010` | Baixa / reconciliação de permutas | I |
| Conexos `com298` | Títulos a vencer e aprovados para baixa | II |
| **Nexxera** | Envio de remessa + leitura de retorno bancário | II |
| **GED** | Upload do documento que justifica a NC/ND | III |
| **SharePoint** | Origem dos PDFs de NC/ND | III |

> O Conexos é o **mesmo tenant** já integrado no código (`src/backend/domain/client/ConexosClient.ts`) —
> mas **apenas o lado leitura** (`list*`/`get*`). **A escrita no ERP** (executar permuta na `fin010`,
> conciliar baixa) **não existe ainda** e precisa ser desenhada e validada na primeira `/feature-new`
> de Permutas/SISPAG (ver `ontology/_inbox/migration-debt.md` O3 — risco arquitetural #1).
> Nexxera, GED e SharePoint são integrações **novas**, a serem contratadas via `/feature-new` (cada
> uma gera seu `ontology/integrations/<nome>.md`).

---

## 5. Requisitos não-funcionais (invariantes do domínio)

- **Segurança e acesso:** autenticação corporativa (login institucional) + controle de acesso por perfil (RBAC).
- **Multi-filial:** as soluções operam sobre todas as filiais.
- **Auditoria:** trilha completa (quem, quando, o quê), registrada e persistida.
- **Integração Conexos resiliente:** gestão de sessão, retry e tratamento de limites de chamada.
- **Observabilidade:** monitoramento de execuções + alertas de falha antes de gerar impacto.
- **Padronização:** aderência aos padrões da área de Tecnologia da Columbia (futura centralização em portal único).

---

## 6. O que NÃO é deste domínio (delimitação)

- Negociação comercial com exportador; julgamento financeiro sobre divergência cambial (permanece com o analista).
- Aprovação para baixa em si (SISPAG) e decisões sobre o que pagar.
- Geração das NC/ND e dos PDFs (seguem no fluxo atual do cliente).
- Conciliação retroativa do passivo histórico como garantia de zerar (tratada como diagnóstico, não promessa).

---

*Domínio modelado para a Columbia Trading. Entrega: Kavex (created by Clonex).*
