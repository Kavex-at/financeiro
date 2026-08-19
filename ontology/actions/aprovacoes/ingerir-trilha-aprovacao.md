---
name: ingerirTrilhaAprovacao
type: action
entity: TituloAprovacao
ontology_version: "0.10"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0049_aprovacao_trilha.sql
  - src/backend/domain/client/ConexosAprovacoesClient.ts
  - src/backend/domain/interface/aprovacoes/ports.ts
  - src/backend/domain/service/aprovacoes/IngestaoAprovacoesService.ts
  - src/backend/domain/service/aprovacoes/EtapaStatusResolver.ts
  - src/backend/domain/service/aprovacoes/StatusWorkflowResolver.ts
  - src/backend/domain/service/aprovacoes/DuracaoCalculator.ts
  - src/backend/domain/repository/aprovacoes/TituloAprovacaoRepository.ts
  - src/backend/domain/repository/aprovacoes/EtapaAprovacaoRepository.ts
  - src/backend/domain/repository/aprovacoes/AprovacaoIngestaoRunRepository.ts
  - src/backend/jobs/ingest-aprovacoes.ts
last_review: 2026-08-19
preconditions:
  - "Sessão Conexos resolvida por `ConexosSessionResolver`; fora de request (job/cron) cai no usuário-robô (ADR-0007)."
  - "Escopo de filiais EXPLÍCITO em `FILS` ou `APROVACOES_INGEST_FIL_CODS` — lista vazia aborta com exit 1 em vez de varrer todas (PV-09)."
  - "Janela de emissão definida por `APROVACOES_BACKFILL_DESDE` (epoch ms); ausente, o job usa 12 meses a partir de agora (PV-08)."
  - "Advisory lock `APROVACOES_INGEST_LOCK_KEY` (918273649) disponível — o lock é adquirido pelo JOB, não pelo serviço."
  - "Migration 0049 aplicada (`aprovacao_titulo`, `aprovacao_etapa`, `aprovacao_ingestao_run`)."
postconditions:
  - "Cada título visitado persistido em `aprovacao_titulo` via UPSERT (chave natural `fil_cod:doc_cod:tit_cod`), com `status_workflow` DERIVADO das etapas."
  - "Trilha de cada título sincronizada em `aprovacao_etapa` (UPSERT por `fil_cod:doc_cod:tit_cod:fbl_cod:ftb_cod`); etapas que sumiram DAQUELE título viram `ativo = false` — nunca deletadas."
  - "Run de auditoria em `aprovacao_ingestao_run` com filiais, janela, totais, status e cursor (`fil_cod`, `pagina`, `doc_cod`) gravado DEPOIS de cada título persistido."
  - "Nenhuma escrita no ERP (D2) — leitura Conexos + escrita LOCAL (Postgres)."
side_effects:
  - "Leitura paginada de `psq014/list` (500 por página, teto de 200 páginas por filial) + **uma chamada `fin026/infoTitulo/list` POR TÍTULO** enquanto PV-07 não liberar o `fin103`."
  - "UPSERT em `aprovacao_titulo` e `aprovacao_etapa`; INSERT/UPDATE em `aprovacao_ingestao_run` a cada título (gravação do cursor)."
  - "Advisory lock: uma segunda execução simultânea encerra com aviso, sem escrever nada."
  - "Falha de qualquer chamada ao ERP fecha a run com `status='error'` + mensagem e propaga — o que já foi persistido permanece, e `RETOMAR=1` continua daí."
---

# ingerirTrilhaAprovacao — materializa a trilha de aprovação dos títulos a pagar

> **Vigência:** 2026-08-19 (ADR-0038, fatia F1). Varre o universo de títulos a pagar do Conexos e
> materializa, para cada um, o cabeçalho e a trilha de aprovação no nosso Postgres. É **READ-ONLY no
> ERP** — a única escrita é o banco próprio, e o port injetado **não expõe** método de escrita, de
> modo que a violação seria um erro de compilação, não uma questão de disciplina.

## Gatilhos

| Gatilho | Caminho | `triggered_by` |
|---------|---------|----------------|
| **Manual, por linha de comando** | `npm run job:ingest-aprovacoes` (`src/backend/jobs/ingest-aprovacoes.ts`) | `TRIGGERED_BY` ou `'cron'` |
| **Retomada** | `RETOMAR=1 npm run job:ingest-aprovacoes` | idem (reaproveita a run interrompida, não abre outra) |

> **Não existe rota HTTP nem cron provisionado.** Diferente de `ingerirPagamentos` (Frente II), que
> tem `POST /sispag/ingestao` e cadência diária, a Frente V hoje só roda por invocação manual do job.
> Isso é estado atual, não decisão de arquitetura: enquanto a varredura custar uma chamada ao ERP por
> título (**PV-07**), agendá-la sem combinar janela e horário com a Columbia seria irresponsável.

Variáveis de ambiente:

| Variável | Efeito | Ausente |
|----------|--------|---------|
| `FILS` / `APROVACOES_INGEST_FIL_CODS` | filiais a varrer, separadas por vírgula | **exit 1** — varrer "todas" por acidente é caro no ERP e demorado (PV-09) |
| `APROVACOES_BACKFILL_DESDE` | piso da janela de emissão, epoch ms | 12 meses a partir de agora (PV-08) |
| `RETOMAR` | `1` retoma a última run interrompida | run nova |
| `TRIGGERED_BY` | rótulo do gatilho na auditoria | `'cron'` |

## Fluxo

`IngestaoAprovacoesService.executar`:

1. **Abre ou retoma a run.** Com `RETOMAR=1`, `ultimaRunRetomavel()` devolve a run interrompida e o
   serviço continua nela, herdando `id` e totais. Sem retomada, abre run nova (`status='running'`).
2. **Para cada filial**, pagina o universo com `listUniverso` (`psq014/list`, `pageSize` 500, teto de
   200 páginas). Numa retomada, filiais já concluídas são puladas e a paginação recomeça na página do
   cursor.
3. **Para cada linha da página**, `processarTitulo`:
   - Linha sem `docCod` ou `titCod` é **ignorada** — gravar um título órfão é pior que perdê-lo.
   - **A filial vem do REGISTRO** (`row.filCod`), não da varredura. Ver *Invariante I5* abaixo.
   - `listTrilha` lê a trilha daquele título (`fin026/infoTitulo/list/{filCod}/{docTip}/{docCod}/{titCod}`).
   - Cada linha vira uma `EtapaAprovacao`: `EtapaStatusResolver` decide o status (e acumula lacunas),
     `DuracaoCalculator` decide a duração (ou se recusa a calculá-la).
   - `sincronizarTrilha` faz o UPSERT das etapas e desativa **as daquele título** que não vieram.
   - `StatusWorkflowResolver` deriva o `statusWorkflow` do conjunto de status das etapas.
   - `primeiraEtapaEm = min(recebidoEm)`, `ultimaAcaoEm = max(agidoEm)`, `tempoTotalSegundos` derivado.
   - Título com pelo menos uma etapa recebe a lacuna `SEM_DATA_FINALIZACAO` (**PV-04**).
   - `upsert` do título.
4. **Grava o cursor** (`filCod`, `pagina`, `docCod`) e os totais — **depois** da persistência.
5. Fecha a run (`success`) — ou (`error` + mensagem) e **propaga** a exceção.

## Por que o cursor vem depois da persistência

Se o cursor fosse gravado antes, uma queda entre "gravei o cursor" e "persisti o título" faria a
retomada **pular** o título — um buraco silencioso no histórico. Gravando depois, o pior caso é
**reprocessar um título**, e o UPSERT por chave natural torna isso inofensivo.

O custo do erro é assimétrico: um título repetido não custa nada; um título faltando num painel de
diagnóstico é um dado que ninguém sabe que está faltando.

## Por que a retomada existe

Sem acesso ao `fin103` (**PV-07**), cada título custa **uma chamada ao ERP**. Só a filial 2 tem 23.632
títulos a pagar em 12 meses. Uma varredura assim leva horas e **vai** cair — de rede, de sessão, de
deploy. Recomeçar do zero no título 12.000 custaria doze mil chamadas inúteis; o cursor transforma o
custo da falha em quase zero.

A retomada só é correta porque a listagem do universo usa `orderList` explícito por `docCod`. Sem
ordenação estável entre execuções, o Conexos não garante a mesma ordem entre páginas — e a retomada
pularia ou repetiria títulos sem nenhum sinal de erro. Ver
[regra de idempotência](../../business-rules/idempotencia-ingestao-aprovacao.md).

## Invariante I5 — a filial vem do registro

`const filCod = row.filCod ?? filCodDaVarredura;`

Consultar a trilha com a filial errada devolve `count: 0` **sem erro**: um falso negativo mudo, em
que o título aparece como "sem workflow" quando na verdade tem trilha completa. Foi exatamente o que
aconteceu com o doc 4156 (filial 1) consultado como filial 2 durante a sondagem. Por isso `fil_cod`
faz parte da chave primária e **nunca** tem default.

## Idempotência

- **Por chave natural:** reprocessar o mesmo título não duplica linha, em nenhum dos dois níveis.
- **Anti-fantasma POR TÍTULO**, não global. A doutrina da Frente II (`marcarInativosForaDaRun`) seria
  destrutiva aqui: o backfill é parcial por natureza — uma janela, uma filial, interrompível — e
  marcaria como fantasma todo o histórico que simplesmente não foi revisitado nesta passada.
- **Nada é apagado.** Etapa que some do ERP (`regerarBloqueios`, **PV-06**) fica `ativo = false` com o
  último estado conhecido.
- **Exclusão mútua** por advisory lock **no job**. Ver a ressalva abaixo.

## Ressalvas conhecidas (verificadas no código, não hipóteses)

1. **O advisory lock está no job, não no serviço.** `withAdvisoryLock` envolve a chamada em
   `jobs/ingest-aprovacoes.ts`. Quem invocar `IngestaoAprovacoesService.executar` por outro caminho
   — uma rota manual futura, por exemplo — **não herda a exclusão mútua** e precisa reaplicá-la. O
   cenário "duas runs simultâneas: a segunda falha sem escrever" do contrato de teste da regra de
   idempotência, portanto, não tem teste de serviço.
2. **A retomada assume filiais em ordem crescente.** O salto de filiais já concluídas é
   `if (filCod < retomada.cursorFilCod) continue`. Com `FILS=3,1,2`, a filial 1 seria pulada numa
   retomada iniciada na 3. Passar a lista ordenada evita o caso; o código não a ordena.
3. **Numa retomada com janela padrão, a janela se desloca.** `APROVACOES_BACKFILL_DESDE` ausente faz o
   job calcular `agora − 12 meses` **a cada execução**, e a retomada não relê o `emissao_desde`
   gravado na run. Dias depois, a retomada varre uma janela ligeiramente diferente da original. Fixar
   `APROVACOES_BACKFILL_DESDE` explicitamente em backfills longos elimina a variação.
4. **`moeda` nunca é preenchida.** A coluna existe na migration 0049 e o campo existe no contrato,
   mas o mapeamento do `psq014` não lê moeda alguma. Decidir a origem ou podar a coluna.
5. **`dataFinalizacao` é sempre `null`** — `docDtaFinalizacao` não vem na projeção acessível
   (**PV-04**/**PV-07**). O backend **não fabrica** o campo a partir de `docDtaEmissao`: seria uma
   mentira silenciosa exatamente no ponto onde o cliente ancorou o aceite.

## Segurança / consistência

- **READ-ONLY no ERP (D2):** `TrilhaAprovacaoGatewayInterface` expõe apenas `listUniverso` e
  `listTrilha`. Os endpoints de escrita do domínio (`trocaBloqueio`, `regerarBloqueios`,
  `fin103/aplicarComando`, `bloqueioManual`) **liberam pagamento** — não podem estar a uma chamada de
  distância de um job de leitura.
- **Auditoria:** cada rodada grava quem/quando/status/filiais/janela/totais e o cursor.
- Datas do Conexos trafegam em **epoch ms**; string ISO é recusada pelo ERP com erro de
  `ECnxDataType`. `paraData` só converte número finito.
- SQL parametrizado nos repositories.

## Por que está na ontologia (universalidade)

Universal: um título a pagar passa por alçadas antes de ser liberado, e **medir esse trânsito é
diagnóstico de gargalo** em qualquer operação financeira. A estrutura — varredura do universo +
leitura da trilha por título, UPSERT por chave natural, anti-fantasma por título, cursor retomável,
fail-safe sobre status desconhecido — é do domínio. O que é configuração do tenant: a janela de
backfill, as filiais, o `docTip`, e qual endpoint do ERP projeta a trilha.
