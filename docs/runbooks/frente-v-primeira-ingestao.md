# Runbook — Frente V: primeira ingestão e estreia do painel de aprovações

> A Frente V é **read-only no ERP** (ADR-0038 D2) — não há risco de escrita indevida, e por isso este
> runbook é bem mais leve que o do `fin010`. O que ele protege é outra coisa: **estrear um painel
> vazio ou com número errado na frente do cliente**.
>
> **Atualização 2026-08-19:** duas dessas lacunas foram fechadas antes da estreia.
> O SQL agora é validado contra um **PostgreSQL real** por `npm run verify:sql-aprovacoes`
> (Postgres embarcado, sem Docker), e a ingestão roda ponta a ponta contra um **ERP fake HTTP** em
> `jobs/ingest-aprovacoes.e2e.test.ts`. O que continua sendo estreia de verdade na Fase 1 é o
> contato com o **Conexos real** e com o **banco de produção**.

## Flags

| Flag | Default | Efeito |
|------|---------|--------|
| `APROVACOES_ENABLED` | ausente ⇒ **ligado fora de produção, DESLIGADO em produção** | Gate da frente. Fail-safe deliberado: a frente ainda não estreou |
| `FILS` / `APROVACOES_INGEST_FIL_CODS` | — | Filiais a varrer. **Sem valor, o job recusa rodar** (varrer "todas" por acidente é caro no ERP) |
| `APROVACOES_BACKFILL_DESDE` | 12 meses atrás (epoch ms) | Piso da janela de emissão. Ver **PV-08** |
| `RETOMAR` | `0` | `1` continua a última run interrompida em vez de recomeçar |

O `EnvironmentProvider` é `@singleton` com cache — **mudar flag exige restart** do serviço.

---

## Fase 1 — Homologação

### 1.1 Aplicar a migration

**Antes de subir**, rode a verificação local — ela pega erro de SQL sem depender de ambiente:

```bash
cd src/backend && npm run verify:sql-aprovacoes
```

A `0049_aprovacao_trilha.sql` roda no boot (`appContainer.initDatabaseAndMigrate`). Suba o backend
apontado para o banco de homologação e confirme no log:

```
[appContainer] applied N migration(s): ... 0049_aprovacao_trilha.sql
```

**Se falhar aqui, é erro de sintaxe SQL** — o teste `AprovacoesSql.test.ts` valida consistência de
parâmetros, mas não sintaxe nem tipos. Confira as três tabelas:

```sql
\d aprovacao_titulo
\d aprovacao_etapa
\d aprovacao_ingestao_run
```

### 1.2 Primeira ingestão, escopo mínimo

Comece pequeno — a filial 3 tinha só 3 títulos na sondagem, o que a torna o alvo ideal para a
primeira execução:

```bash
cd src/backend
FILS=3 npm run job:ingest-aprovacoes
```

Esperado no log: `run=<uuid> titulos=N etapas=M`.

### 1.3 Conferir o que entrou

```sql
SELECT status_workflow, COUNT(*) FROM aprovacao_titulo GROUP BY 1;
SELECT nome, acao, status, COUNT(*) FROM aprovacao_etapa GROUP BY 1,2,3 ORDER BY 4 DESC;
SELECT id, status, total_titulos, total_etapas, cursor_doc_cod FROM aprovacao_ingestao_run;
```

**Sinais de que algo está errado:**

| Sintoma | Provável causa |
|---------|----------------|
| Tudo `SEM_WORKFLOW` | `filCod` errado na leitura da trilha — é o falso negativo mudo da invariante I5 |
| `duracao_segundos` nulo em toda etapa concluída | `ftbTimCmd == ftbTimBloq` chegando do ERP, ou parse de data quebrado |
| Muitos `INDETERMINADO` | Esperado se aparecerem status além de 1 e 2 — confira `status_erp` e alimente **PV-01** |
| `total_titulos = 0` | Janela de emissão curta demais, ou filial sem títulos a pagar |

### 1.4 Idempotência — a verificação que mais importa

Rode **a mesma ingestão de novo** e confirme que as contagens **não dobram**:

```sql
SELECT COUNT(*) FROM aprovacao_titulo;
SELECT COUNT(*) FROM aprovacao_etapa;
```

Os números têm de ser idênticos aos da primeira rodada. É o UPSERT por chave natural fazendo seu
trabalho; se dobrarem, a chave natural está errada e o histórico já nasceu corrompido.

### 1.5 Retomada

Interrompa uma ingestão maior no meio (`Ctrl+C`) e rode com `RETOMAR=1`. Confirme no log que ela
recomeça na página do cursor, não do zero. Sem isso, o backfill de 23.632 títulos da filial 2 nunca
termina — qualquer queda de rede custaria tudo.

### 1.6 O painel

Com `APROVACOES_ENABLED` ligado (default fora de produção), abra `/aprovacoes` e verifique:

- [ ] O **horário do snapshot** aparece no topo (invariante I7).
- [ ] Títulos `SEM_WORKFLOW` aparecem — não são erro, são ~metade da base.
- [ ] Um título `AGUARDANDO` mostra a etapa atual e "parada há", **rotulado como espera em curso**.
- [ ] Um título `INDETERMINADO`, se houver, mostra o `status_erp` cru — é o que fecha a PV-01.
- [ ] A timeline de um título aprovado mostra quem, quando recebeu, quando agiu e a duração.
- [ ] A coluna de data se chama **Emissão**, nunca "Finalização" (PV-04).

### 1.7 Caso de aceite do cliente

Se o doc 4156 / título 1 da **filial 1** estiver na janela ingerida, ele é o caso canônico:

```
CONTROLLER · COMPRAS · LIBERAR · DANILO_LARA
recebeu 2026-05-14 07:12:46 → liberou 2026-05-15 06:41:40 → 23h 28m
```

A tela precisa reproduzir isso. É a frase que o cliente usou para definir o que queria.

---

## Fase 2 — Produção

**Pré-requisitos, todos obrigatórios:**

1. Fase 1 concluída sem sintoma da tabela acima.
2. Backfill de produção rodado **com o painel ainda desligado** — o cliente não deve ver a tela antes
   de ela ter dado. Comece pela filial de menor volume e avance.
3. Uma passada de olho da analista sobre os números, **antes** de anunciar.

**Só então:** `APROVACOES_ENABLED=true` em produção + restart.

Kill-switch: `APROVACOES_ENABLED=false` + restart. Reversível em menos de um minuto, sem redeploy.

### Cadência

O job não está agendado. Depois da estreia, defina a cadência com base no volume observado — o custo
hoje é **uma chamada ao ERP por título** enquanto **PV-07** (acesso à tela `fin103`) não sair. Com
esse acesso, a varredura vira paginada e a cadência deixa de ser um problema.

---

## Lacunas conhecidas neste runbook

- ~~Sintaxe SQL e semântica de tipos não validadas~~ → **fechado**: `npm run verify:sql-aprovacoes`
  aplica a migration num PostgreSQL real, confere idempotência, tabelas, índices e CHECK, e exercita
  os repositories. Rode antes de qualquer deploy que toque o schema.
- ~~A ingestão nunca rodou~~ → **parcialmente fechado**: roda contra ERP fake HTTP no e2e. O que
  falta é o Conexos **real**, e isso é a Fase 1.2.
- **Dez pendências de negócio** seguem abertas em `ontology/_inbox/frente-v-pendencias-validacao.md`.
  As que podem mudar número na tela: **PV-01** (status 7), **PV-02** (`LIBERAR` vs `APROVAR`) e
  **PV-03** (o que `ftbTimBloq` significa de fato).
