# HML preparado para o E2E real — o que foi criado/corrigido (2026-08-03)

> Sessão assistida no navegador (Yuri digitando, agente navegando/conferindo). **Nada foi alterado
> em produção** — produção foi usada apenas como fonte de leitura para replicar os cadastros.
> Transcrição dos originais: `replica-config-nde-hml.md`. Sondagens: `sondagem-conexos-hml.md`.

## Criado/corrigido no HML (filial 2, salvo indicação)

| # | Objeto | Ação | Resultado |
|---|--------|------|-----------|
| 1 | Conta de projeto (ctb004, projeto 1) | **Criada** espelhando produção (3.30.037) | **ctpCod 699** · "ADIANTAMENTO DE CLIENTE ENCOMENDA" — confirmada no `lov/ContasProjetoCtb` dos processos pri 17 (fil 1) e pri 186 (fil 2) |
| 2 | Configuração de Documento (com065) | **Criada** espelhando a **248** de produção | **gcdCod 186** · "NOTA DE DEBITO PAGAMENTO ANTECIPADO" · ATIVO · Tela FISCAL DE SAÍDA · Tipo NOTA DE DÉBITO |
| 3 | Item da config 186 | **Criado** | projeto 1 · conta 699 · 100% · CC 3.00 - OPERAÇÕES COMERCIAIS · tipo operação **114** (NOTAS DE DEBITO E CREDITO ELETRONICA) · CFOP interno **5949-ND** · externo vazio |
| 4 | CFOP 5949-ND (cmn023) | **Corrigido**: campo "Tipo Documento" do bloco FILTRO limpo (estava "NOTA DE DEBITO ELETRÔNICA"; produção tem vazio) | Passou a aparecer no lookup do item da config |
| 5 | CFOP 6949-ND (cmn023) | **Criado** por cópia do 5949-ND | Existe e ATIVO, mas **ainda não vinculado ao tipo de operação 114** → não aparece no lookup de CFOP externo |

## Pendência conhecida (não bloqueante para a Fase B)

`validaConfigDoc` do com297 (gcd 186, pri 186) responde **200 com `AVISO
COM_068.NAO_ENCONTRADO_CFOP_CONFIG_DOC`** — falta o CFOP externo no item. É **AVISO**, e o
orquestrador só falha em `ERRO` (`assertNoErpError`), então a Fase B pode rodar e o ERP dirá se o
CFOP externo é realmente exigido na geração. Para resolver depois: vincular `6949-ND` ao tipo de
operação 114 (a lista do tipo 114 tem hoje: 1202ND, 1202RV, 2202ND, 2949ND, 5922ND, 5927ND, 5949ND,
6119ND) — a tela desse vínculo ainda não foi localizada.

## Divergências HML × produção (registrar no dossiê do teste)

- Tipo de operação: produção usa "NOTAS DE DEBITO E CREDITO"; HML só tem "NOTAS DE DEBITO E CREDITO
  **ELETRONICA**" (114).
- CFOP 5949-ND: descrição em produção é "NOTA DE DEBITO - PAGAMENTO ANTECIPADO" (HML: "NOTA DE
  DEBITO"); Descrição Oficial diverge ("VENDA PARA ENTREGA FUTURA - PAGAMENTO..." × "ESTORNO DE
  CRÉDITO..."). Só o campo de filtro (Tipo Documento) foi alinhado — o resto é cosmético.
- A grade de CFOP do HML já traz coluna **"Classificador Tributário IBS/CBS"** (5949-ND = `000001`),
  evidência de que o leiaute da reforma existe no ERP e a solução não o lê (RT-001).

## Bugs de produto confirmados ao vivo (backlog `/feature-tweak`)

1. **Default errado do env** `COM297_GCD_NOTA_DEBITO_NOME = 'NOTA DE DÉBITO ELETRÔNICA'`: esse é o
   nome do **Tipo de Documento**, não da **Configuração de Documento**. Em produção a configuração
   chama-se **"NOTA DE DEBITO PAGAMENTO ANTECIPADO"** (gcd 248, filial 2).
2. **`resolveGcdCodByName` é inviável**: `com297/list` devolve `gcdCod`/`gcdDesNome` **nulos** (tanto
   no HML quanto no snapshot de produção lido) — o resolver por nome nunca funcionaria live. O
   override por env (`COM297_GCD_NOTA_DEBITO`) é o único caminho válido; o fallback deveria
   fail-closed com mensagem clara em vez de tentar o resolver.

## Env do E2E (já configurado em `src/backend/.env`, gitignored)

```
CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api
CONEXOS_FIL_COD=2 · SN_GCD_COD=150 · COM297_GCD_NOTA_DEBITO=186
RECEBIMENTO_INGEST_FIL_CODS=2 · RECEBIMENTO_INGEST_DIAS=365
# escrita permanece OFF por default; a Fase B liga por execução
```
