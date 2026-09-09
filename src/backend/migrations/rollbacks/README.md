# Scripts de reverse (NÃO são migrations)

Estes arquivos **não são aplicados automaticamente**. Ficam num subdiretório de
propósito: o `MigrationRunner` faz `readdirSync(MIGRATIONS_DIR)`, que **não é
recursivo**, e filtra por `.endsWith('.sql')`. Um reverse solto em
`migrations/` seria aplicado no boot seguinte e desfaria a migration que acabou
de subir — em silêncio, porque o runner o registraria em `schema_migrations`
como se fosse mais uma migration para a frente.

## Como rodar

Manualmente, com supervisão, contra o banco certo:

```bash
psql "$databaseConnectionString" -v ON_ERROR_STOP=1 \
  -f src/backend/migrations/rollbacks/0054_estado_ja_permutado.rollback.sql
```

Depois de reverter, **remova a linha correspondente de `schema_migrations`** se a
intenção for reaplicar a migration mais tarde:

```sql
DELETE FROM schema_migrations WHERE name = '0054_estado_ja_permutado.sql';
```

## Política (Regis-Review 2026-09-08, card `rollback-0054`)

Migration com `UPDATE` sobre mais de 1.000 linhas exige script de reverse na
revisão. O critério não é "dá para desfazer com git" — é se a **informação
anterior é reconstruível a partir do que sobrou no banco**.
