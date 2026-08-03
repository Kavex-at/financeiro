# Réplica no HML da configuração real da NDe (produção → homologação)

> **Fonte:** leitura na UI de PRODUÇÃO em 2026-08-03 (sessão navegador acompanhada pelo Yuri;
> nenhuma escrita em produção). **Descoberta central:** a Configuração de Documento da NDe em
> produção chama-se **"NOTA DE DEBITO PAGAMENTO ANTECIPADO"** (gcd **248**, FILIAL 2 — o com065 é
> por filial: URL `com065#/cadastro/2/248`). O nome default da automação
> (`COM297_GCD_NOTA_DEBITO_NOME = 'NOTA DE DÉBITO ELETRÔNICA'`) está **ERRADO** — esse é o nome do
> *Tipo de Documento* (tpd) usado nos docs manuais do HML, não da Configuração (gcd).
> **Bug de produto a corrigir** (`/feature-tweak`): default do env + `resolveGcdCodByName` inviável
> (com297/list não expõe gcd*).

## Config 248 (produção, filial 2) — transcrição integral

**Cabeçalho**
| Campo | Valor |
|---|---|
| Código | 248 (gerado; no HML será outro) |
| Descrição | NOTA DE DEBITO PAGAMENTO ANTECIPADO |
| Situação | ATIVO |
| Tipo de Processo | IMPORTAÇÃO POR ENCOMENDA |
| Própria | SIM |
| Série | NFE1 |
| Adiantamento | NÃO |
| Tipo Documento | NOTA FISCAL ELETRÔNICA |
| Condição de Pagamento | NÃO FINANCEIRO |
| Plano Financeiro | REMESSA/RETORNOS DIVERSOS |
| Armazém | 10-NAO SE APLICA |
| Cópia | ORIGINAL |
| Previsão | NÃO |
| Incentivo Fiscal | NENHUM |
| Telas Utilizadas | FISCAL DE SAÍDA |
| Tipo | NOTA DE DÉBITO |
| Moeda | (vazio) |

**Configurações adicionais**
| Campo | Valor |
|---|---|
| Forma de Rateio dos Itens | GERAL |
| Aplicar Encargo Adicional | NÃO |
| Sistema | NÃO |
| Agenc. Inter. | AMBOS |
| Nível de Alteração Permitida | TOTAL |
| Finalidade do Processo | IMPORTAÇÃO |
| Câmbio | NÃO |

**Itens do documento (1 linha)**
| Ordem | Projeto | Conta Projeto | Rateio | Centro de Custos | Tipo de Operação | CFOP Interno | CFOP Externo |
|---|---|---|---|---|---|---|---|
| 1 | 1 | ADIANTAMENTO DE CLIENTE ENCOMENDA | 100,00% | 3.00 - OPERAÇÕES COMERCIAIS | NOTAS DE DEBITO E CREDITO | 5949-ND | 6949-ND |

## Doc real de referência (produção, HOJE 2026-08-03): com297 doc 18348

Processo 3254, pessoa 194 (L-FOUNDERS), ref 0097LFL/26, série NFE1, número 0, valor 100,00,
situação HOMOLOGAÇÃO. Item: produto **41978 PAGAMENTO ANTECIPADO**, tipo de operação NOTAS DE
DEBITO E CREDITO, CFOP **6949-ND**, CC 3.00, qtde 1. **Resumo de tributos do doc: só
ICMS/PIS/COFINS/IPI/ICMS-ST (tudo 0,00) — NENHUM campo IBS/CBS exibido no painel, em 03/08/2026.**
(Evidência adicional RT-001 — conferir o XML autorizado.)

## Dependências para recriar no HML (filial 2)

1. **Conta de Projeto "ADIANTAMENTO DE CLIENTE ENCOMENDA" (projeto 1)** — NÃO existe no HML
   (sondagens 3/4b/5). Existe em produção; transcrever o cadastro e recriar no HML ANTES da config.
2. Tipo Documento "NOTA FISCAL ELETRÔNICA" — existe no HML (doc 105 usa). ✔
3. Série NFE1 — existe no HML (doc 111). ✔
4. Plano Financeiro "REMESSA/RETORNOS DIVERSOS" — verificar no HML.
5. Tipo de Operação "NOTAS DE DEBITO E CREDITO" + CFOP 5949-ND/6949-ND — verificar no HML.

## Conta de Projeto 690 · 3.30.037 "ADIANTAMENTO DE CLIENTE ENCOMENDA" (produção, ctb004, projeto 1 IMPORTAÇÃO)

| Campo | Valor |
|---|---|
| Conta | 3.30.037 |
| Descrição | ADIANTAMENTO DE CLIENTE ENCOMENDA |
| Filial | (vazio) |
| Visível ao Grupo | NENHUM |
| Valor Orçado | (vazio) |
| Natureza | DÉBITO |
| Ex. Comp. Doc. Fin. | NÃO |
| Cód. Plano de Contas | 279 → "ADTO. CLIENTE - NACIONAL" |
| Uso da Conta | AMBOS |
| Câmbio | NENHUM |
| Realiza Orçamento | SIM |
| Encargo | (vazio) |
| Encargo para Despesa no Faturamento | FEE-TOTAL NFE |
| Tipo de Operação | IMPORTAÇÃO POR ENCOMENDA |
| Receita | NÃO |
| Faturar | SIM |
| Tipo Despesa | NENHUM |
| Tipo | DESPESAS |
| Tipo de Conta da SN | DESPESAS |
| Rateio de Despesas | NÃO |
| Classificador | NENHUM |
| Adicional / % Adicional / Regra p/ Cálculo SN | (vazios) |
| Corretagem | NENHUM |
| Situação | ATIVO |
| Tipo de Despesa | (vazio) |
| SN Processo Automática | NÃO |
| Libera Despesa Automaticamente na Importação | SIM |
| Exibe Conta na Tela de RM | SIM |
| Exibe Conta nos Rel. Gerenciais | SIM |
| Gerenciável pelo Próprio Centro de Custos | SIM |
| Tratamento Saldo Proc. | NÃO |

Dependências no HML a validar nos lookups: Plano de Contas **279** ("ADTO. CLIENTE - NACIONAL") e
encargo **FEE-TOTAL NFE**. Irmã em produção: 691 · 2.01.021 "ADIANTAMENTO DE CLIENTE CTA ORDEM".

## Passo a passo da réplica (Yuri digita, agente navega/confere; NADA é salvo em produção)

1. (Prod) abrir o cadastro da conta de projeto "ADIANTAMENTO DE CLIENTE ENCOMENDA" → transcrever.
2. (HML fil 2) criar a conta idêntica.
3. (HML fil 2) com065 → + Adicionar → replicar a config acima (Descrição idêntica à de produção).
4. Re-sondar `lov/ConfigDocProcesso` (pri 186) → capturar o gcdCod novo → `COM297_GCD_NOTA_DEBITO`
   no `.env` → rodar Fase B (SN → NDe no HML).
