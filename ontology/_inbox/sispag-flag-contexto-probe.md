# SISPAG — sonda do contexto do flag DDA (`titVldReflexoDdaAssoc`)

> Desenho da sonda `src/backend/jobs/probe-flag-contexto.ts` (2026-10-13). Read-only. Precede as regras
> de auto-associação: antes de casar boleto por valor+vencimento, saber quanto do "boleto sem DDA" é
> artefato da forma como lemos o flag.

## A pergunta

O flag sai de `fin015/finItemSispag/titulosPendentes/list/{filCod}/{bncCod}/{flpCod}`. A ingestão
(`listarSinaisDosPendentes`) lê num contexto arbitrário: o **primeiro banco da filial que tem lote
nativo**, no **maior `flpCod`** dele. O banco e o lote entram na URL, então o ERP pode calcular a
associação em relação a eles.

Medição de 2026-10-13 (875 títulos BOLETO sem flag): **207** têm um boleto livre de mesmo valor e mesmo
dia no pool; ~170 deles são MULTILOG (fil 2 e 4), TRANSMAGNA e SANTOS BRASIL (fil 6). O ERP não os flagou.

## Hipóteses

| # | Hipótese | Como a sonda separa |
|---|---|---|
| H1 | Depende do **banco** do lote (o pool DDA é só da conta Itaú ag 0641 / cc 55795) | taxa de flagados por `bncCod` |
| H2 | Depende da **conta** do lote (`ccoCod`) | taxa por `ccoCod` |
| H3 | Depende da **data de débito** do lote (`flpDtaCredito`) vs vencimento do título | flagados com venc ≥ débito × venc < débito, por contexto |
| H4 | Depende do **estado** do lote (rascunho × finalizado) | taxa por `status` |
| H0 | **Não** depende do contexto; a explicação é outra (beneficiário, pagador, banco emissor) | flag estável em todos os contextos |

## O que a sonda faz

1. Por filial, lista contas (bancos) e lotes nativos de cada banco (`fin015/list`, sem cancelados).
2. Escolhe até `MAX_CONTEXTOS` (6) contextos **diversos**: maior/menor `flpCod`, maior/menor data de
   débito, um por estado, um por conta, um por banco.
3. Lê o grid de pendentes inteiro em cada contexto (serial).
4. Compara: mesmo conjunto de títulos? flag estável (`sempre`/`nunca`/`instável`)? quais campos do
   `raw` mudam com o contexto para o mesmo título? há campo com cara de DDA/boleto/barras/vínculo?
5. Com `PROBE_DB_URL`: dos candidatos "mesmo valor+dia, sem flag no banco", quantos aparecem flagados
   em **algum** contexto, por filial e por credor.

Saídas em `PROBE_OUT` (default `/tmp/probe-flag-contexto`): `resumo.json`, `cruzamento-banco.json`,
`grids-fil*.json`, `contextos-fil*.json`, `raw-amostra-fil*.json`.

## Como ler o resultado

| Resultado | Leitura | Próximo passo |
|---|---|---|
| `flag.instavel` ≈ 0 em todas as filiais | **H0**: o contexto não explica | olhar `camposDdaLike` e o `raw` dos 207; hipótese de beneficiário/pagador; sonda por título (HML) |
| `instavel > 0` e a taxa varia por **banco** ou **conta** | **H1/H2** | a ingestão deve ler no contexto certo (banco/conta do pool DDA) ou fazer a união dos contextos; ajuste pequeno, sem matcher |
| a taxa varia com **venc ≥ débito** | **H3**: associação relativa à data do lote | `tem_boleto` é função do lote escolhido; precisa de contexto por data do título, ou deixar de tratar o flag como propriedade do título |
| `candidatosFlagadosEmAlgumContexto` ≈ 207 | a maioria dos candidatos **é** associável pelo ERP | corrigir a leitura; o matcher só cobre o resto |
| `candidatosFlagadosEmAlgumContexto` ≈ 0 | o ERP não associa nem por contexto | o matcher + bind no item é o caminho (sujeito à prova em HML) |
| `camposQueMudamComOContexto` traz campos de banco/conta | confirma o mecanismo | registrar o campo no contrato |
| `camposDdaLike` mostra campo preenchido com id/número do boleto | **o ERP expõe a associação** | usar como verdade para validar o matcher offline |

## Execução

```
cd src/backend
PROBE_PRD=1 PROBE_FILIAIS=2,4,6 databaseConnectionString="" \
  PROBE_DB_URL="$(grep ^databaseConnectionString= .env | cut -d= -f2-)" \
  npx tsx jobs/probe-flag-contexto.ts
```

Custo estimado (a confirmar): filial 2 tem ~2000 pendentes, 4+ páginas de 500 por contexto; 6
contextos × 3 filiais ≈ 70–100 chamadas seriais. Login do robô com `sessionToKill`: derruba a sessão
viva do CLONEX; o app e os crons relogam sozinhos (ver `probe-local-derruba-sessao-conexos`). Rodar
fora do horário de ingestão (07h/12h/16h BRT) e da formação de lotes.

## Limites

- Só vê contextos que **existem**: bancos sem lote nativo na filial não têm `flpCod` para a URL.
- O cruzamento usa "mesmo valor+dia livre" como candidato, sem beneficiário; é uma estimativa do
  resgate, não prova de que o boleto é daquele título.
- Amostra os lotes (6 por filial); a explicação por atributo é correlação sobre contextos, não
  experimento controlado. Se aparecer um padrão, confirmar com um título e dois contextos.
