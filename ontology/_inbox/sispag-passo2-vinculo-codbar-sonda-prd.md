# Sonda PRD somente leitura — permissão do robô sobre os itens do `fin015` (Task 18)

**Status: NÃO EXECUTADA.** O job `src/backend/jobs/probe-prd-readonly-permissao-fin015.ts` foi
implementado e protegido por teste estático (só leitura), mas **não foi rodado**: ele derruba a sessão
viva do robô em PRD e só roda **com o go do maintainer**, fora do horário de analista.

## Como (quando o go vier)

```bash
cd src/backend
databaseConnectionString="" FIL=<filial> BNC=<banco> FLP=<rascunho PRD existente> \
  npx tsx jobs/probe-prd-readonly-permissao-fin015.ts --eu-entendo-que-derruba-a-sessao-do-robo
```

Imprime só contagens (itens, completa, com identidade, com código, associados ao DDA pelo ERP).

## O que o resultado **não** prova

Listar itens **não é prova de permissão de `PUT`** em `fin015/finItemSispag` — **V-PRD1 continua
ABERTO**. A alternativa preferida é pedir à Conexos/Columbia a **matriz de permissões do robô para o
programa `fin015`**.

## Registro (preencher quando executada)

| Campo | Valor |
|---|---|
| Data / quem autorizou | _pendente_ |
| Rascunho lido (fil/bnc/flp) | _pendente_ |
| Itens / completa / com identidade | _pendente_ |
| Observação | _pendente_ |
