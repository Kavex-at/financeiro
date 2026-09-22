# sispag-boundary-fail-closed — follow-ups e aprendizado

Branch `fix/sispag-boundary-fail-closed` · 2026-09-22 · v0.39.1

Quatro achados trazidos pelo Yuri, todos no boundary de LEITURA do Conexos no SISPAG.
Fechados nesta tweak; `rh-1` (aberto desde o regis-review de read-harden) fecha junto.

## O que foi corrigido

| # | Onde | Defeito | Correção |
|---|------|---------|----------|
| 1 | `ConexosSispagClient.ts:31` | `z.coerce.number()` fazia `Number(null) === 0` | `z.preprocess` mapeia `null`/`''` → `undefined`, como o `ConexosExtratoClient` já fazia |
| 1b | `ConexosSispagClient.mapTitulo` | `prontoParaRemessa` sempre `true`; consertar só a coerção o tornaria sempre `false` | tri-estado: `true` quando o read viu destino, `undefined` quando não sabe (migration `0061` torna a coluna nullable) |
| 2 | `ConexosSispagWriteClient.listarLotesNativos` | lia só a página 1 (500 linhas) de uma lista usada como "os lotes que existem" | pagina de verdade; truncar **lança** (parcial aqui manda cancelar lote alheio ou duplicar pagamento) |
| 3 | `ConexosSispagClient.isFilterRejected` | casava QUALQUER 400 → releitura ampla mascarando falha do ERP | exige corpo que nomeie o filtro; 400 mudo ou de outra causa propaga |
| 4 | `LINHA_DIGITAVEL_SCHEMA` | só `/^\d{47}$/` | confere os 4 dígitos verificadores (3× mod-10 + mod-11 geral) e devolve `{total, dropped}` até a tela |

### Nota de evidência (achado #3)

O card `rh-1` pedia "capturar um 400 real do `fin064`" antes de apertar o predicado. A auditoria
não achou **nenhum** 400 de recusa de filtro medido no repositório — mas achou o que torna a
premissa do fallback improvável:

- filtro **desconhecido** é silenciosamente **ignorado** pelo ERP (não gera 400);
- coluna **não-filtrável** (`mnyTitAberto#GT`, `pago#NE`) responde **HTTP 500**, não 400;
- o único 400 de filtro medido é o **filtro obrigatório ausente** (`Generic.REQUIRED_FILTER_ERROR`,
  fin052/fin134/fin095/NdeFiscal) — e ele **se nomeia no corpo**.

Ou seja: a maioria dos 400 que caíam no fallback era outra coisa. O predicado novo casa o que
está medido e propaga o resto. **Não precisou do fixture** — precisou olhar os vizinhos.

## Aprendizado — regras propostas para o CLAUDE.md

> Estágio obrigatório do pipe v2: "que regra teria evitado este bug?". Os achados 1, 2 e 4 são o
> **mesmo** erro em três roupas — o boundary produzindo uma afirmação que o dado não sustenta.

### R1 — `z.coerce.number()` é proibido sozinho em campo vindo do ERP

```diff
  ## Conventions
  ### TypeScript Style
+ - **Zod no boundary: nunca `z.coerce.number()` cru sobre campo de ERP.** `Number(null) === 0`, e o
+   Conexos manda `null` (não ausente) em todo campo de LEFT JOIN. Use sempre
+   `z.preprocess((v) => (v === null || v === '' ? undefined : v), z.coerce.number().optional().catch(undefined))`.
+   Um `0` fabricado não falha: ele vira data de 1970, valor zerado ou flag ligada — e passa em todo
+   `!== undefined` a jusante. Já custou 2 bugs (`fin095` exiMnyLctoCr, `fin064` itsVldModalidade/titDtaVencimento).
```

### R2 — leitura paginada: `pageNumber: 1` fixo é bug até prova em contrário

```diff
+ - **Todo `/list` do Conexos pagina.** `pageNumber: 1` + `pageSize: N` fixos só é aceitável com
+   comentário provando que o resultado é ≤ N por construção. Sem isso, o chamador recebe um
+   PREFIXO e o trata como o conjunto. Já custou 2 bugs (`titulosPendentes`: 24,7% do grid virando
+   "não elegível"; `listarLotesNativos`: marca d'água e busca de órfão sobre lista incompleta).
+   Quando o parcial leva a decisão destrutiva (cancelar, recriar), truncar deve **lançar**, não avisar.
```

### R3 — validação de formato ≠ validação de valor, quando um humano vai agir sobre ele

```diff
+ - **Valor que um humano copia e executa (linha digitável, chave PIX, conta) valida CHECKSUM, não
+   comprimento.** O comprimento é exatamente o que um dígito trocado preserva. E a rejeição precisa
+   ser CONTADA e devolvida: item descartado em silêncio é indistinguível de item que não existe.
```

### R4 — "não sei" é um estado, e precisa caber no schema

```diff
+ - **Não colapse "desconhecido" em `false`/`0` no boundary nem na coluna.** Se o read não pode
+   afirmar, o campo é opcional/NULL. Um `false` fabricado acende aviso em 100% das linhas — o mesmo
+   ruído do `true` fabricado, com o sinal trocado. Quem afirma é a fonte que mede.
```

## Follow-ups (→ tickets, NÃO implementados)

| id | prio | finding | nota |
|----|------|---------|------|
| bfc-1 | P1 | `TituloAPagar.valor` continua `number` com `?? 0` no mapper: um `titMnyValor` nulo ainda vira **R$ 0,00** na tela e soma 0 nos KPIs | com o `numOpt` corrigido o `0` agora é um coalesce EXPLÍCITO e não uma coerção oculta, e o dinheiro que sai usa o valor do grid ao vivo (`RemessaService:957`), então o raio é display/KPI. Tornar `valor?: number` ripple em ~6 sítios (FE `formatBRL`, dois `reduce`, repo) — fora do escopo destes 4 achados. |
| bfc-2 | P2 | os outros `numOpt` do `ConexosSispagClient` (`flpVldStatus`, `titulosCount`, `soma`, `itensRetorno`, `flpDtaCredito`, `borDtaMvto`, `borVldFinalizado`, `vlrTotalLiquido`) ganharam o `preprocess` junto, mas **nenhum** teve o efeito de `null` auditado caso a caso | o followup do ground-truth já pedia "auditar os outros campos `numOpt`". Vale um probe read-only medindo fill-rate por campo no `fin015`/`fin010` antes de confiar em cada um. |
| bfc-3 | P2 | `listarChavesDoLote` e `listarArquivosRemessa` seguem com `pageNumber: 1` fixo | mesmo padrão do achado #2. `listarChavesDoLote` é o mais sensível: alimenta a diferença "o que já entrou no lote" na retomada — um prefixo faria reimportar item já importado. Merece card próprio. |
| bfc-4 | P3 | a linha digitável de **arrecadação/concessionária** (48 dígitos, mod-11 por bloco) seria recusada pelo validador novo | não medida no SISPAG até hoje (todo `itsNumCodbar` visto tem 47). Se aparecer, hoje cai em `dropped` e a tela avisa — degrada visível, não calado. |

## Gates

- **PatternGuardian: PASS no delta.** Todos os arquivos tocados saíram conformes — Client
  (`@singleton() @injectable()`, Zod no boundary, sem `!`), Service (`EnvironmentProvider`, modificadores
  explícitos), Repository (SQL 100% parametrizado), Interface (sem runtime) e as duas migrations
  (a de ida idempotente, a de volta inversa de verdade).
- **DesignSystemReviewer: PASS após correção.** Um achado bloqueante (AC8 — conteúdo assíncrono sem
  `aria-live`) corrigido no mesmo ciclo; o aviso passou a usar o padrão de banner de
  `permutas/components/banners.tsx` (`role="alert"` + `bg-warning-subtle`/`text-warning-foreground` + ícone).

### Achados do PatternGuardian FORA do delta (legado, → tickets)

O agente revisou os arquivos inteiros, não o diff. Os quatro P0 que ele reportou em `routes/sispag.ts`
são **pré-existentes**: existem idênticos em `main` (linhas 380/402/544/545 lá; aparecem em 383/405/547/548
nesta branch só porque o delta acrescentou 3 linhas acima). O único handler que esta tweak toca é o de
`linhas-digitaveis`, que resolve `SispagPainelService` corretamente. Pela política de dívida do CLAUDE.md
(migração **proporcional** ao que a tweak encosta), viram ticket em vez de inflar um fix de boundary num
refactor de extração de serviço.

| id | prio | finding | nota |
|----|------|---------|------|
| bfc-5 | P1 | `routes/sispag.ts:380` resolve `PagamentoIngestaoRunRepository` direto no handler (L7 — rota não fala com repositório) | envolver em `PagamentoIngestaoService.listRecentRuns()` |
| bfc-6 | P1 | `routes/sispag.ts:402` resolve `ConexosSispagClient` direto (e ainda chama a variável de `service`) | envolver num serviço que injete o client |
| bfc-7 | P1 | `routes/sispag.ts:544-545` resolve `RemessaExecucaoRepository` e `ConciliacaoExecucaoRepository` direto | um `ExecucoesQueryService` cobre os dois |
| bfc-8 | P2 | imports de Client/Repository no topo de `routes/sispag.ts` | caem sozinhos quando bfc-5..7 forem feitos |

> Os quatro são **um** ticket na prática (mesmo arquivo, mesma classe de violação). Sugestão: abrir
> um único card "rotas SISPAG param de falar com repositório/client" em vez de quatro.
