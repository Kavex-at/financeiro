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

## Resultado (PRD, 2026-10-13, filiais 2/4/6)

**H0 confirmada: o flag NÃO depende do contexto.** 10 contextos lidos (bancos 4 e 10; contas 1, 2 e 8;
lotes rascunho, finalizado e `status 3`; débitos de 24/02 a 14/10): **0 títulos instáveis**, 0 campos do
`raw` que mudam, mesmo conjunto de títulos (a única diferença é 1 título novo na fil 4 entre leituras).

| Filial | Contextos | Títulos | Flagados (sempre) | Instáveis |
|---|---|---|---|---|
| 2 | 5 | 1863 | 160 | 0 |
| 4 | 3 | 846 | 60 | 0 |
| 6 | 2 | 610 | 80 | 0 |

- **Cruzamento com o banco:** dos 200 candidatos "mesmo valor+dia, livres, sem flag" (123 + 16 + 61),
  **0** aparecem flagados em algum contexto. E nenhum título sem flag no banco aparece flagado no ERP:
  o `tem_boleto` da carteira **bate com o ERP** (a leitura da ingestão está correta).
- **O grid não expõe a associação:** campos DDA-like são só `titVldReflexoDdaAssoc` (160/1863),
  `titVldReflexoDdaDesassoc` (0/N) e `titEspCodbar` (0/N). Não há id/número do boleto no grid.
- **Limite do teste:** só os bancos 4 (Itaú) e 10 (fil 2) têm lote nativo; os outros ~13 bancos de cada
  filial não têm `flpCod` para a URL e não puderam ser testados.
- **Observação:** os flagados são quase todos títulos com vencimento ≥ a data de débito do lote
  (ex. 160/1552 contra 0/311 no lote de 24/02) — consequência do pool só ter boletos a vencer, não um
  efeito do contexto (o total flagado é idêntico em todos).

### O que sobrou (offline, mesmo dia)

Entre os pares valor+dia únicos (178 flagados, 146 sem flag), o sem-flag é **por credor+filial**, não
por título: MULTILOG BRASIL f2 (61), TRANSMAGNA f6 (16), SANTOS BRASIL f6 (12), MULTILOG COMÉRCIO f2/f6 (8)
têm 0 flagados e **uma única conta emissora**. O único caso misto, **MULTILOG S/A f2** (53 flagados, 22
sem flag, mesma conta emissora Bradesco ag 2656 cc 6500), se separa pela **série do número do boleto**:
flagados `0315xx000`/`0318xx000`, sem flag `74xx000`/`7480000`. Conta emissora, valor e dia iguais.

Leitura: a regra de associação do ERP olha algo que o pool e o grid não mostram (entidade emissora /
beneficiário, ou o número do documento). **Próximo passo** (HML, escrita controlada): importar num lote
de teste um título candidato sem flag com `titVldReflexoDdaAssoc = 1` e ver se o ERP responde à
pergunta `FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO` e anexa as barras — isto é, se a associação
acontece no import mesmo com o flag do grid em 0. Em paralelo, perguntar à analista da Columbia como ela
associa hoje os boletos MULTILOG manualmente.

## Limites

- Só vê contextos que **existem**: bancos sem lote nativo na filial não têm `flpCod` para a URL.
- O cruzamento usa "mesmo valor+dia livre" como candidato, sem beneficiário; é uma estimativa do
  resgate, não prova de que o boleto é daquele título.
- Amostra os lotes (6 por filial); a explicação por atributo é correlação sobre contextos, não
  experimento controlado. Se aparecer um padrão, confirmar com um título e dois contextos.
