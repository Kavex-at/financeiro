# Regis-Review — follow-ups de `sispag-ted-pix`

Run `docs/regis-review/2026-09-29-0104-sispag-ted-pix/` (8 QAs em sonnet, escopo = diretórios tocados pela
feature, modo `--quick`). Cards completos (Problema / Melhoria / Resultado esperado) no
`KANBAN.md` do run. Nota geral 7,0; Modifiability 5,5 é o único QA abaixo de 7.

**P0:** nenhum dos 8 QAs reportou P0. O único P0 do ciclo veio do PatternGuardian (o logger global
de requisições imprimia o body de `POST .../destino` com conta, chave PIX e CPF/CNPJ) e foi
**remediado** no commit `e8cb1e5` (`redactBody` redige as chaves de destino; `errorMiddleware`
redige o corpo de erro do Conexos; testes novos). Não é follow-up.

Os itens abaixo **não** foram implementados.

## Antes de ligar qualquer flag TED/PIX (recomendação do consolidador)

`fault-tolerance-1`, `deployability-1` e `security-1` são S e não dependem de nada externo. O
`fault-tolerance-1` é o de maior impacto potencial: se a flag for desligada no meio de uma
retomada parcial, os itens restantes voltam à regra do `main` sem conferir o destino já enviado.

## P1

### P1 — security-1 — Jobs com `console.error(e)` cru podem vazar a senha do Conexos
Pedido explícito do usuário neste ciclo. Os jobs de `src/backend/jobs` que terminam com
`console.error(e)` imprimem o AxiosError inteiro numa falha de login, e o `config.data` dele é o
corpo do login com a senha. Contagem medida em 2026-09-28: 10 arquivos com `console.error(e)`,
1 com `console.error(err)`, 3 com `console.error(error)` (o usuário tinha contado 11). PRE_EXISTING;
a sonda nova deste ciclo já imprime só `(e as Error).message`. Trocar por um helper de erro seguro e
um teste que reprove o padrão em `jobs/`.

### P1 — testability-1 — Gravar goldens de `.REM` TED/PIX depois do PRD supervisionado
0 de 6 hipóteses (H1, H3–H7) com evidência gravada; os testes concordam com o próprio gerador.

### P1 — modifiability-1 — Extrair a montagem de itens de remessa do `RemessaService`
1.499 LOC (main 1.111), complexidade cognitiva 93 em `gerarRemessaSerializado`. Mesma extração que
`integrability-3` e `testability-2`.

### P1 — modifiability-2 — Separar a edição de destino do `LotePagamentoService`
438 → 676 LOC no delta.

### P1 — fault-tolerance-3 — Reaper de lotes presos e reconciliação diária com o fin015
PRE_EXISTING. Cobre também `availability-2` e `deployability-3`.

## P2

### P2 — fault-tolerance-1 — Preservar a assinatura de destinos do ledger em toda gravação
Com as flags ligadas ou não; falhar fechado quando o parse de `destinos` falhar; mesclar em vez de
substituir numa retomada com `apenasChaves`. 0 → 3 testes.

### P2 — deployability-1 — Declarar as 3 flags TED/PIX no `render.yaml` e no `DEPLOY.md`
Ordem de ligação: `SISPAG_TED_ENABLED`, depois `SISPAG_DESTINO_MANUAL_ENABLED`, depois
`SISPAG_PIX_ENABLED` (checklist do tasks.md).

### P2 — performance-1 — Paralelizar o pré-voo de destino com fan-out limitado
Um PR só com `performance-3`, `availability-1` e `fault-tolerance-2`.

### P2 — performance-3 — Orçamento de tempo no pré-voo e timeout confirmado dos clients Conexos

### P2 — availability-1 — Limitar tempo e volume das leituras de cadastro no pré-voo

### P2 — fault-tolerance-2 — Limitar e paralelizar o pré-voo de destinos

### P2 — availability-3 — Confirmar o campo do documento do favorecido antes do go-live
`CAMPO_DOCUMENTO_FAVORECIDO = 'pesNumCpfCnpj'` é hipótese; errado, todo destino digitado falha fechado.

### P2 — integrability-1 — Confirmar o campo de CPF/CNPJ e gravar fixtures de `cmn025/list` e `cmnPessoasPix`

### P2 — deployability-2 — Frontend tolerante a backend sem as rotas de destino

### P2 — security-2 — Alertar troca de destino e limitar por ator
Sem quatro olhos por decisão (ADR-0054 D3); a trilha é só forense. Casa com a permissão específica
para informar destino prevista no catálogo de permissões (ADR-0053).

### P2 — security-3 — Retenção e cifra de coluna do destino digitado
A trilha só-inclusão conflita com eliminação (LGPD); depende de decisão jurídica.

### P2 — security-4 — Exigir role nos GETs de SISPAG e validar o claim admin
PRE_EXISTING.

### P2 — testability-3 — `ClockProvider` injetável nos serviços SISPAG
PRE_EXISTING.

### P2 — testability-4 — Teste de integração Postgres para o SQL de destino do repositório
A migration 0066 tem integração; `setDestinoManualItem` e o JOIN LATERAL só rodam contra mock.

### P2 — availability-2 — Alerta ativo para remessa falha ou indeterminada

### P2 — integrability-3 — Extrair a montagem do fin015 do `RemessaService`
Mesma extração de `modifiability-1`.

### P2 — modifiability-3 — Tirar acesso a repository/client de `routes/sispag.ts`
PRE_EXISTING.

### P2 — testability-2 — Fatiar o `RemessaService` e quebrar o teste de 2.057 LOC

## P3

### P3 — integrability-2 — Alertar drift de schema por endpoint Conexos

### P3 — integrability-4 — Padronizar com Zod os leitores restantes do `ConexosSispagClient`

### P3 — performance-2 — Memoizar a leitura do título e do documento do favorecido no fluxo

### P3 — testability-5 — Pisos de cobertura por arquivo e testes de propriedade nos módulos de destino

### P3 — deployability-3 — Smoke check pós-deploy que confirma versão e última migration
