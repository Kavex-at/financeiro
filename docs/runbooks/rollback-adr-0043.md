# Runbook — reverter a ADR-0043 (snapshot de 5 estados)

> **Leia o parágrafo seguinte antes de qualquer comando.** Reverter o deploy do
> backend **não** reverte o banco. Fazer só metade é a única forma de piorar a
> situação em vez de melhorá-la.

## Por que a ordem importa

A migration 0054 **alargou** as CHECKs para aceitar 5 estados. Alargar aceita o
novo mas continua aceitando o velho: `bloqueada` segue sendo um valor legítimo.
Então o código anterior à ADR-0043 — que colapsa tudo que não é `elegivel` em
`bloqueada` — consegue escrever por cima de dado já corrigido **sem violar
constraint nenhuma**.

Medido em produção: ~80 linhas de `permuta_adiantamento` voltariam a `bloqueada`
na primeira ingestão pós-rollback. E a tabela passaria a conter duas semânticas
misturadas, distinguíveis só pela data da run.

A migration **0055** existe para tornar isso impossível: ela proíbe as
combinações que só o código antigo produz. Com ela no ar, o backend antigo
**falha alto** na primeira escrita em vez de corromper em silêncio. Falhar é
recuperável; corromper não é.

## Cenário A — reverter só o deploy, manter o banco corrigido

**Não faça.** Com a 0055 no ar, a ingestão vai falhar; sem ela, vai corromper.
Se o motivo do rollback não tem relação com permutas, prefira um hotfix na
frente. Se tem, vá para o cenário B ou C.

## Cenário B — rollback de emergência, decidir sobre o dado depois

Quando o objetivo é voltar o backend antigo ao ar rápido e o dado pode esperar.

```bash
# 1. Destravar a escrita antiga (NÃO desfaz a reclassificação do histórico)
psql "$databaseConnectionString" -v ON_ERROR_STOP=1 \
  -f src/backend/migrations/rollbacks/0055_guarda_estado_colapsado.rollback.sql

# 2. Reverter o deploy do backend para a release anterior a v0.34.1
```

**Custo assumido:** a partir daqui a tabela mistura semânticas. As runs novas
nascem colapsadas, o histórico segue corrigido, e nada marca o corte além da
data. É solução de janela curta. Registre o horário do passo 1 — é ele que
define a fronteira quando alguém for reconciliar depois.

## Cenário C — reverter tudo, banco inclusive

```bash
# 1. Reverter o deploy do backend PRIMEIRO
#    (código novo contra schema velho quebra na CHECK binária restaurada)

# 2. Reverter o banco — este script já derruba as travas da 0055 no §0
psql "$databaseConnectionString" -v ON_ERROR_STOP=1 \
  -f src/backend/migrations/rollbacks/0054_estado_ja_permutado.rollback.sql

# 3. Se a intenção for reaplicar depois, liberar as migrations
psql "$databaseConnectionString" -c \
  "DELETE FROM schema_migrations WHERE name IN ('0054_estado_ja_permutado.sql',
                                                '0055_guarda_estado_colapsado.sql');"
```

O reverse da 0054 tem self-test próprio: confere que o snapshot voltou a ser
binário e que o header bate com ele, e **aborta sem commitar** se não bater.

**Verificado em PG 17:** o reverse é idempotente (duas execuções, hashes
idênticos) e `0054 → reverse → 0054` devolve o estado original linha a linha. É
seguro reaplicar depois.

## Por que o reverse é possível

O backfill da 0054 é destrutivo quanto ao `status`, mas **não** quanto ao
`motivo_bloqueio` — nenhuma linha teve o motivo alterado. E o mapeamento original
é uma função do motivo, então o inverso é determinístico.

Isso é uma propriedade que precisa ser **preservada**: há um teste
(`migrations/rollbacks.test.ts`) que falha se alguém acrescentar um
`SET motivo_bloqueio` à 0054, porque isso tornaria o reverse irreconstruível.

## O que este runbook não cobre

Restaurar de PITR do Supabase. Se o reverse falhar no self-test, **pare** e
chame o Yuri — o self-test falhando significa que o banco não está no estado que
o script assume, e insistir piora.
