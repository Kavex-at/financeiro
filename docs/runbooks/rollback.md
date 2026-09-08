# Runbook — reverter um deploy quebrado

> **Quando usar:** o deploy passou no CI, subiu, e produção quebrou. É o cenário típico aqui,
> porque Conexos e Supabase só existem de verdade em produção — o CI nunca os viu.
>
> **Meta: reverter em ≤ 5 minutos sem consultar ninguém.**

`render.yaml` tem `autoDeploy: true`: todo push em `main` sobe sozinho. Não há passo humano entre
o merge e a produção, então a reversão é o único freio.

---

## A regra que decide tudo: código e schema não voltam juntos

Antes de clicar em qualquer coisa, responda **uma** pergunta: *o deploy quebrado trouxe migration?*

| Situação | Reverter o código é… | Por quê |
|---|---|---|
| Deploy **sem** migration nova | **seguro** | O schema não mudou. A versão anterior roda contra o mesmo banco de sempre. |
| Deploy **com** migration **aditiva** (coluna/tabela nova, índice) | **seguro** | A versão anterior simplesmente ignora o que não conhece. Deixe a migration aplicada. |
| Deploy **com** migration **destrutiva** (drop/rename de coluna, mudança de tipo, backfill que sobrescreve) | **NÃO reverta sozinho** | O código antigo espera o schema antigo, que não existe mais. Vá para "Quando escalar". |

**A assimetria é o ponto:** reverter *código* sem reverter *schema* é seguro; o contrário não é.
Nunca reverta uma migration para acompanhar um rollback de código sem alguém revisando junto — é
assim que se descobre corrupção de dados.

Para saber se veio migration: compare `src/backend/migrations/` entre o commit quebrado e o
anterior, ou olhe o `CHANGELOG.md` da versão.

---

## 1. Reverter o backend (Render)

1. Dashboard do Render → serviço **`financeiro-backend`** → aba **Events** (ou **Deploys**).
2. Localize o último deploy **`Live`** anterior ao quebrado. Confira a mensagem de commit e o
   horário — não vá pelo tempo relativo, que engana sob pressão.
3. Menu `⋯` daquele deploy → **Rollback to this deploy** → confirmar.
4. O Render **reconstrói e reimplanta aquele commit**; leva alguns minutos. Não é instantâneo.

> As migrations rodam no **boot** do processo, via `BootMigrator` (ver `src/backend/index.ts`), não
> em pre-deploy. Isso significa que a versão revertida também executa o `BootMigrator` ao subir —
> outra razão para não mexer em migration destrutiva no meio de um rollback.

## 2. Reverter o frontend (Vercel), se necessário

O frontend é lockstep com o backend (mesma versão em `package.json`), mas os deploys são
independentes. Se a quebra é de UI ou de contrato de API:

1. Dashboard da Vercel → projeto do frontend → **Deployments**.
2. Deploy anterior → `⋯` → **Promote to Production**. É quase instantâneo (troca de alias).

## 3. Validar que a reversão pegou

```bash
curl -s https://<host-do-backend>/health
```

- **200** com `version` = a versão **anterior** → o rollback do backend pegou.
- **503** com `status: "shutting_down"` → o processo ainda está drenando o shutdown. Espere até
  ~25s e repita; o balanceador já tirou a instância do pool.
- Sem resposta → o serviço não subiu. Vá para "Quando escalar".

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<host-do-backend>/health/pipelines
```

- **200** → nenhum pipeline parado nem run abandonada.
- **503** → há pipeline parado ou execução órfã. **Esperado logo após um incidente**: uma
  requisição cortada no meio deixa execução em `reconciling`. Não é motivo para reverter de novo —
  o `reaper-sispag` publica, e `GET /operacao` (requer `admin`) mostra o detalhe.

Por fim, confirme na tela que o sintoma original sumiu. `/health` verde não prova que o negócio
voltou — prova que o processo subiu.

---

## Quando escalar (não resolva sozinho)

Chame o Yuri / a Kavex antes de agir se:

- O deploy quebrado trouxe **migration destrutiva** (a linha vermelha da tabela acima).
- O rollback subiu, mas o sintoma continua → a causa provavelmente **não** é o deploy. Reverter de
  novo não ajuda, e cada ciclo derruba requisições em voo.
- Há suspeita de **escrita parcial no Conexos** — lote no `fin015`, baixa no `fin010`, NDe emitida.
  Cancelar rascunho no ERP ou decidir que uma baixa já existe é decisão humana com dinheiro no
  meio; o próprio `reaper-sispag` foi escrito para **publicar e não agir** por essa razão.
- Duas reversões seguidas falharam ao subir.

Ao escalar, leve: horário do deploy quebrado, versão anterior e versão nova, saída de `/health` e
`/health/pipelines`, e o que `GET /operacao` mostra.

---

## Depois

1. Abra o incidente com a linha do tempo (deploy → detecção → reversão → confirmação).
2. `git revert` do commit em `main` — **o rollback do Render não mexe no repositório**. Sem isso, o
   próximo push reintroduz o bug.
3. Se a quebra passou pelo CI, o gate tem um buraco: o teste que faltava vale mais que o fix.

Ver também: [`DEPLOY.md`](../../DEPLOY.md) · [`fin010-write-cutover.md`](fin010-write-cutover.md)
