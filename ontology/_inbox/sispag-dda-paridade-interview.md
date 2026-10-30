# Entrevista (tweak) — `boletos-dda-sispag`: paridade da aba Boletos DDA com Títulos a pagar + fetch do DDA

> Modo: **tweak** (delta sobre a ontologia v0.52.0). Branch `fix/sispag-dda-paridade`, worktree
> `.claude/worktrees/sispag-dda-paridade`, base `origin/main` @ `23c68339` (v0.79.0).
> Decisão de partida (Yuri, 2026-10-30): **PARIDADE TOTAL** com a aba Títulos a pagar
> (`situacao/TitulosAbaSituacao.tsx`) e o design system (`src/frontend/docs/design-system/`).
> Cada pergunta traz um **default recomendado**: sem resposta, o default vale.
> Responda editando a linha `Resposta:`.

> **APROVADO (Yuri, 2026-10-30):** defaults de Q1–Q11 como escritos, inclusive Q6 e Q10. Q11: a
> guarda "lista vazia não apaga" **entra**; os demais itens de F5 ficam como follow-up
> (`sispag-dda-paridade-followups.md`). Q12 segue sem resposta e não bloqueia.

## 0. Verificação do levantamento (feita nesta etapa, em `origin/main`)

Confirmado no código: UI 1–9, F1, F3, F4, F5 (três itens). Correções ao levantamento:

- **F2, parte do 409:** o 409 **não** vira "API 409". `sincronizarBoletosDda` trata o 409 e lança
  `SincronizacaoDdaEmAndamentoError` com mensagem fixa (toast `info`). Quem perde o corpo são os
  **outros** status (`throw new Error(\`API ${res.status}\`)`, `lib/sispag.ts:1910`): um 500 com
  `userMessage` chega como "API 500".
- **F2, parte do timeout:** não há timeout no cliente (`lib/http.ts` não usa `AbortController`). Se o
  HTTP cai, é no proxy (Render) ou no navegador. O risco é real (o botão relê **todos** os arquivos
  importados nos últimos 60 dias, sem prazo, com 3 leituras simultâneas), mas o timeout em produção
  **não foi medido**. Ver pergunta Q10.
- **F4, "cada tecla":** a busca já tem debounce de 300 ms. O que é verdade: cada busca aplicada e
  cada troca de filtro/página roda a consolidação inteira no servidor (~24 mil linhas no escopo
  "todos"), e a requisição superada não é abortada (só descartada pelo `vivo`).
- **UI 10, estado ao trocar de aba:** a aba Títulos **também** perde os filtros ao trocar de aba (o
  `useTabelaTitulos` vive dentro do `TabsContent`, que desmonta). "Igual a Títulos" hoje = perder.
  Ver Q7.
- **Títulos não persiste filtro na URL** (nenhum `useSearchParams` em `app/sispag/`). "Igual a
  Títulos" = sem URL. Ver Q7.
- **Cache por `sincronizadoEm` (performance-2) sozinho é chave errada:** a consolidação depende de
  pool + carteira (`listAtivos`) + títulos em lote aberto + grupos (cache de 30 s). Ver Q9.

## 1. Cards, segmentos e chips (mapeamento das situações)

**Q1. Qual o conjunto de cards e o que cada um significa?**
Títulos tem 4 cards de ação (Prontos `success`, Precisam de ação `danger`, Vencem em até 2 dias
`warning`, Lotes esperando `info`), botão **cheio** na cor do card, e o card tem um único botão.

Default recomendado (4 cards, mesmo `KPIGrid columns={4}`):

| Card | Cor | Número | Rodapé | Botão (cheio) |
|---|---|---|---|---|
| **Casados com título** (`VINCULADO`) | `success` | qtd | R$ | "Ver os casados" / "Tirar o filtro" (`default`, como "Selecionar prontos") |
| **Para conferir** (`CANDIDATO` + `AMBIGUO`) | `danger` | qtd | R$ · "N com um candidato · M ambíguos" | "Conferir" (`BOTAO_PERIGO`) → segmento Para conferir |
| **Vencem em até 2 dias** | `warning` | qtd (exclui `VINCULADO`) | R$ · "N para conferir · M sem título" | "Ver só os urgentes" (`BOTAO_ALERTA`) |
| **Pagam vários títulos** (Em grupo) | `primary` (não reusa `info`) | qtd | R$ · "N sugeridos · M confirmados" | "Ver os grupos" (botão cheio `primary`) |

O "Boletos no período" (total) sai dos cards e vira o segmento **Todos** (Q2), como em Títulos.
`SEM_TITULO` não é card: é o segmento "Sem título" (não exige ação nossa na maioria dos casos;
o pool é da conta pagadora e traz boletos que não são da carteira).

Por que "Para conferir" é `danger` e não `info`: é o equivalente de "Precisam de ação" (o analista
tem de decidir). Se preferir não alarmar, alternativa: `warning` para Para conferir e o card de
urgentes passa a `danger`.
Resposta: default aprovado (Yuri, 2026-10-30).

**Q2. Segmented control e chips.** Default: barra igual à `FiltroSituacaoBarra`, generalizada:
segmentos `Todos | Casados | Para conferir | Sem título`, cada um com qtd + R$ e ponto de cor;
com **Para conferir** escolhido, chips CHIP "Por situação: Candidato N · Ambíguo M". O chip
**Em grupo** é ortogonal à situação (como hoje no servidor) e fica sempre visível na linha de chips.
Cards e barra editam o **mesmo** estado (não dois controles para o mesmo filtro): o card só liga
o segmento/chip. A linha de botões de situação atual e o chip "2 dias" somem. O "?" abre um
`RegrasSituacao` do DDA com o texto de `regraCandidato` (hoje solto no cabeçalho).
Resposta: default aprovado (Yuri, 2026-10-30).

## 2. Totais em R$

**Q3. R$ por situação vem do servidor?** Default: **sim**. `contagem` ganha valor por chave
(`{ qtd, valor }`, o mesmo `Total` de Títulos), calculado **depois de filial + busca + filtros de
coluna, antes do filtro de situação** (mesma base dos números de hoje). Também para `emGrupo` e
para `urgentes` (`hoje`, `ate2Dias`). Soma de `b.valor` do boleto (não do título). Boleto em grupo
conta uma vez (é um boleto).
Resposta: default aprovado (Yuri, 2026-10-30).

## 3. Filtros de coluna

**Q4. Quais colunas filtram e ordenam?** Default (`ColumnHeaderFilter`, todos no servidor; o
`ColumnHeaderFilter` exige ordenação, então toda coluna filtrável ordena):

| Coluna | Filtro | Ordena |
|---|---|---|
| Situação | `FiltroMultipla` (VINCULADO/CANDIDATO/AMBIGUO/SEM_TITULO, com total) — mesmo estado do segmento | sim |
| Boleto (nº) | `FiltroTexto` (número do boleto) | sim |
| Valor | `FiltroFaixaNumerica` | sim |
| Vencimento | `FiltroPeriodo` + `FiltroMultipla` de faixas `VENCIDO/HOJE/1-2/3-7/8+` (as de Títulos) | sim (default: vencimento asc) |
| Banco | `FiltroMultipla` (facetas do servidor, com total) | sim |
| Título | `FiltroTexto` (credor ou `doc/tit`) | sim (credor) |
| Filial (coluna nova, curta) | `FiltroMultipla` com opção **"Sem filial"** (Q6) | sim |

A busca livre **fica** (colar código de barras/linha digitável é o uso real), como campo único na
barra; é a única divergência de Títulos, que não tem busca. O seletor de filial e o par de datas
da `FiltroBarra` legada saem (viram filtros de coluna). Pílulas de filtro ativo + "Mostrando X de Y"
+ "Limpar filtros" iguais a `TabelaTitulos`. Página de **25**, paginação no padrão de
`TabelaTitulos` (extraída para um componente comum).
Resposta: default aprovado (Yuri, 2026-10-30).

## 4. "Vencem hoje" e "2 dias"

**Q5. O que é urgente para um boleto?** Default: vencimento do **boleto** (dia civil BRT, via
`BankingCalendar.todayBrt` no servidor, nunca `Date.now()` — ADR-0070) em `HOJE` ou `1-2`, e
situação ≠ `VINCULADO` (o casado já tem título; não pede ação na aba). O card liga as faixas
`HOJE` + `1-2` no filtro de vencimento, como `FAIXAS_URGENTES` de Títulos.
**Faixa "vencem hoje"** (análoga à `FaixaBloqueadosHoje`): boletos não casados com vencimento hoje,
até 4 linhas (nº, valor, credor do candidato principal, situação) + "Ver só estes"; **cor `warning`,
não `danger`** (um boleto sem título hoje não é um pagamento perdido nosso). Ação por linha: só
"Ver candidatos" quando houver; nada de confirmar daqui (confirmar continua na gaveta do título).
Some no escopo sem boletos de hoje.
Resposta: default aprovado (Yuri, 2026-10-30).

## 5. Filial

**Q6. Boleto sem filial no filtro de filial.** Hoje um boleto sem filial passa em **qualquer**
filtro de filial (`PaginacaoBoletoDda.ts:52,110`), e `SEM_TITULO`/`AMBIGUO` inflam a contagem de
cada filial. Default:
- filial de exibição = a do vínculo; senão a **comum a todos os candidatos** (hoje só o candidato
  único dá filial; um ambíguo com 3 candidatos da filial 1 fica "sem filial" sem motivo);
  senão **sem filial**.
- filtrar por filial(is) mostra **só** boletos daquela(s) filial(is). "Sem filial" é uma opção
  explícita da faceta, com total.
- a lista `filiais` (facetas) vem com total por filial e o total "sem filial".
Isto altera uma frase da entidade `BoletoDda` (ver o diff de ontologia). O pool continua global.
Resposta: default aprovado (Yuri, 2026-10-30).

## 6. Estado da aba

**Q7. Filtros na URL? Estado ao trocar de aba?** Default: **sem URL**, igual a Títulos (que não
usa URL). **Mas** o estado sobrevive à troca de aba: guardado num store do módulo da aba
(`useSyncExternalStore`, vida = sessão da página, some no reload), sem tocar `page.tsx`. Se quiser
o mesmo para Títulos, é outro tweak.
Resposta: default aprovado (Yuri, 2026-10-30).

## 7. Defeitos de fetch (F1–F4)

**Q8. Quais entram?** Default: **os quatro**.
- **F1:** "DDA ainda não sincronizado" só com resposta OK e `sincronizadoEm` ausente. Primeira
  carga = skeleton (`Skeleton.KPICard` × 4 + `TableSkeleton`); erro do GET = `EmptyState` de erro
  com "Tentar de novo" (já existe) e o cabeçalho diz "não foi possível ler o DDA".
  Empty state sem `sispag:executar` não manda clicar em "Atualizar DDA": diz "A ingestão atualiza
  o DDA às 07h, 12h e 16h".
- **F2:** o botão ganha **prazo** (Q10) e o toast usa o corpo da resposta de erro (`error`/`userMessage`)
  para todo status ≠ 2xx.
- **F3:** toast conta certo: `novos lidos = novos − falhas − adiados` (o servidor passa a separar:
  `arquivosNovosLidos`/`arquivosRelidosLidos`, ou o FE mostra "N lidos, M adiados, K com falha");
  tipo FE ganha `arquivosAdiados`; `parcial` vira `toast.warning` "Faltaram M arquivos: rode de
  novo". A aba mostra o `dda.estado` da última ingestão quando for `parcial`/`falhou`/`ocupada`.
- **F4:** `AbortController` nas requisições superadas; a aba recarrega quando a ingestão da página
  termina (prop `versaoCarteira` — 1 linha em `page.tsx`) e quando `sincronizadoEm` muda; cache curto
  da consolidação no servidor (Q9).
Resposta: default aprovado (Yuri, 2026-10-30).

**Q9. Cache da consolidação (F4).** Default: memo no servidor por
`escopo + todayBrt + sincronizadoEm(pool) + ultimaRunEm(carteira)`, TTL 30 s (cobre lotes e
grupos, que não têm marca de versão), invalidado junto com `SugestaoBoletoCache.invalidar()`.
Filtrar/ordenar/paginar roda sobre o consolidado em cache. Só por `sincronizadoEm` (como diz o card
performance-2) erra: a carteira muda sem o pool mudar. Medir o tempo da consolidação antes (RED).
Resposta: default aprovado (Yuri, 2026-10-30).

**Q10. Prazo do botão "Atualizar DDA" (F2).** Default: o mesmo da ingestão, `DDA_PRAZO_NA_INGESTAO_MS`
= 60 s, com o mesmo "o que está em voo termina". O que sobrar vira `arquivosAdiados` e o toast
manda rodar de novo. Alternativa (maior, não recomendada agora): 202 + endpoint de status com
polling. Job avulso continua sem prazo. Isto emenda a ADR-0067 ("Botão — sem prazo").
Resposta: default aprovado (Yuri, 2026-10-30).

## 8. Regras de sincronização (F5)

**Q11. Algum item de F5 entra?** Default: **nenhum** agora; viram follow-up (mudam regra de sync):
1. "DDA parado há N h" dispara toda noite útil (vão de 15 h entre o cron das 16h e o das 07h; limiar
   8 h corridas) e só avança quando um arquivo é salvo (`max(sincronizado_em)` de `boleto_dda_arquivo`).
   Pergunta de negócio já aberta em `sispag-dda-na-ingestao-regis-followups.md` ("rodada esperada perdida").
2. Arquivo importado há mais de 60 dias nunca é relido (janela pela data de importação, não pelo
   vencimento dos boletos).
3. Lista vazia do Conexos apaga os boletos do arquivo (`BoletoDdaRepository.ts:67-69`, fault-tolerance-3).

Exceção proposta, **só se aprovar**: o item 3 é pequeno e só **protege** (não apagar arquivo que
tinha itens quando o ERP devolve lista vazia; registrar `warn`). É seguro e tem teste direto. Se
aprovar, entra; senão, follow-up.
Resposta: aprovado (Yuri, 2026-10-30) — a guarda do item 3 entra; itens 1 e 2 são follow-up.

## 9. Pergunta aberta ao Yuri (P0 para priorizar F1–F4)

**Q12. Como é, em produção, "o fetch do DDA não funciona como esperado"?** Preciso de um caso
concreto para escrever o teste RED que reproduz o sintoma. Qual destes (ou outro)?
- (a) a aba diz "DDA ainda não sincronizado" com o pool sincronizado (F1: primeira carga ou erro do GET);
- (b) "Atualizar DDA" fica girando e termina em erro/timeout, e o clique seguinte dá "já existe uma
  sincronização em andamento" (F2);
- (c) o toast diz "N arquivos novos" e os boletos não aparecem (F3: adiados/falhas contados como novos);
- (d) depois da ingestão da tela, a aba mostra o pool velho até trocar um filtro (F4);
- (e) o aviso "DDA parado há N h" aparece com o pipeline saudável (F5.1);
- (f) um boleto que está no fin124 não aparece (F5.2/F5.3) — se for este, qual boleto (`ddcCod`/nº)?
Em que horário, com que usuário (com ou sem `sispag:executar`), e se possível o `sincronizadoEm`
mostrado na tela. Default se não houver resposta: tratar (a)–(d) e deixar (e)–(f) como follow-up.
Resposta: (em aberto; não bloqueia — default aplicado: (a)–(d) tratados, (e)–(f) follow-up.)

---

# Rodada 2 (2026-10-30) — agendador + conferência rápida do DDA ao abrir a tela

> **APROVADO (Gabriel, 2026-10-30):** Q13 — formação automática nunca antes das 06:30 BRT; o slot das
> 05:07 só atualiza dados; a formação roda no primeiro slot ≥ 06:30 que não acha formação no dia, e no
> das 12:13 se os da manhã se perderem. Q14 — uma por DIA ÚTIL (BankingCalendar; nada em fim de
> semana/feriado; o cron das 07:07 continua ingerindo todo dia); manual sem trava. Q15–Q18 e o alerta:
> defaults. As duas rodadas saem juntas na ontologia v0.53.0 (app v0.81.0).

> Escopo novo no MESMO PR (`fix/sispag-dda-paridade`). **Etapa 1 apenas**: aguarda aprovação do
> Gabriel antes de código. Fatos de produção medidos em 2026-10-30 (só leitura), trazidos pelo
> coordenador; verificados no código desta branch.

## Q12 respondida

O aviso "DDA parado há 11 h" apareceu na primeira abertura do dia (Flavia, 09:34 BRT; última
sincronização 29/10 21:46, de uma abertura da noite). A abertura dispara a ingestão (TTL de 30 min
vencido), que sincroniza o DDA primeiro, mas a aba já tinha desenhado com o pool velho. O refetch por
`versaoCarteira` (rodada 1) resolve a parte "presa"; esta rodada ataca a causa (nada sincroniza de
madrugada nem cedo) e o significado do aviso.

## Fatos conferidos no código

- `ingest-sispag.yml`: `0 10 * * *` (07h BRT, ingestão + formação) e `0 15,19 * * 1-5`. Os três no
  minuto :00, o pior horário do agendador do GitHub. Formação só com
  `github.event.schedule == '0 10 * * *'` (ou disparo manual).
- Minutos já ocupados por outros crons (UTC): permutas `0 9,15,21`; extratos `:20`; reaper
  `:10,:25,:40,:55`; nde `:35`; staleness `:45`; lotes `:48 11-22`; perfil-canal dom 06:17.
- A formação (`FormacaoLotesService.formar`) **não** grava trilha (nem `job_execucao`, nem outra). O
  único freio é o advisory lock `FORMACAO_LOCK_KEY`, que só serializa. Não há como saber "já formou hoje".
- O manual `POST /sispag/lotes/formar` (admin) usa o mesmo serviço.
- `fin124/list` devolve por arquivo só `ddcCod`, nome, `ddcTimCad`, `ddcTimCanc`, `ddcVldStatus` —
  **nenhuma contagem de itens nem marca de alteração**. Consequência: a conferência rápida enxerga
  arquivo novo, cancelado e troca de status; **não** enxerga o Conexos gravando vínculo num arquivo já
  importado. Isso continua só na releitura de 60 dias da ingestão/cron.
- `CarteiraAtualizacaoService.atualizarSeDefasada` (a chamada da abertura): com carteira < 30 min
  devolve `fresca` sem tocar o Conexos; com carteira velha roda a ingestão inteira (que sincroniza o
  DDA). A cadeia da abertura já é sequencial (carteira → lotes → ajustes; ADR-0066 §3).
- `ultimaSincronizacao` = `max(sincronizado_em)` de `boleto_dda_arquivo`: só anda quando um arquivo é
  GRAVADO. Uma passada que listou com sucesso mas não gravou nada não conta.
- Próxima migration livre: **0092** (main está em 0091; nenhuma branch remota tem 0092+).

## Perguntas (default recomendado entre parênteses)

**Q13 (P0) — horários novos.** (Default, UTC → BRT:
- `7 8 * * 1-5` → 05:07, **rede de segurança da manhã** (ingestão + formação);
- `7 10 * * *` → 07:07, **principal** (ingestão + formação; todo dia, como hoje);
- `13 15,19 * * 1-5` → 12:13 e 16:13, só ingestão.
Minutos :07/:13 não colidem com nenhum outro cron nem com permutas às 09:00 UTC (06:00 BRT). Com o
atraso típico de 2–5 h, o slot das 05:07 ainda cai antes das ~09h.) Aceita formar já às 05h quando o
slot das 07h atrasar ou cair? Alternativa: formação só a partir das 06:30 BRT (o job pula se cedo).
Resposta:

**Q14 (P0) — trava "uma formação por dia".** (Default: a regra sai do workflow e vai para o serviço.
`formar({ triggeredBy: 'cron' })` grava trilha em `job_execucao` (pipeline novo
`sispag-formacao-lotes`, aditivo; ADR-0042 permite trilha para quem não tinha) e, **dentro do mesmo
advisory lock**, pula com `ja_formado_hoje` se existir execução `success`/`partial` com
`started_at >= BankingCalendar.startOfTodayBrt()`. O workflow passa a rodar o passo de formação nos dois
slots da manhã (`github.event.schedule` ∈ {os dois}); quem garante "no máximo uma" é o serviço, então
atraso, rodada dupla ou disparo junto não fragmentam. O manual (`POST /sispag/lotes/formar` e
`workflow_dispatch`) **ignora** a trava: é ato explícito, como hoje.) Concorda que o manual continue
podendo formar de novo no mesmo dia? E dia "civil" (como hoje, inclui sábado/domingo) ou "útil"?
(Default: civil, comportamento atual.)
Resposta:

**Q15 — onde mora "conferido em".** (Default: migration **0092** com tabela de UMA linha
`boleto_dda_conferencia (id = 1, conferido_em, origem, arquivos_lidos, erro)`, gravada a cada
listagem bem-sucedida do `fin124` — tanto na conferência rápida quanto na passada completa (botão,
ingestão, job). Alternativa: linhas em `job_execucao` (pipeline `sispag-dda-conferencia`): dá histórico,
mas cria até ~50 linhas/dia por abertura e um pipeline novo para o read-model de staleness. O build já
copia `migrations/*.sql` (`copy-to-dist.ts`).)
Resposta:

**Q16 — quando a abertura confere o DDA.** (Default: no caminho `fresca` de
`atualizarSeDefasada` (carteira recente, nada mais rodaria), **se** a última conferência tem mais de
`SISPAG_DDA_CONFERENCIA_MIN` = 10 min (`EnvironmentProvider`). No caminho `atualizada` a ingestão já
faz a passada completa (e grava `conferido_em`). Em `em_andamento`/`falha_recente` não confere. Tudo na
MESMA requisição, então continua sequencial com a sincronização dos lotes (ADR-0066 §3) e sem tela nova
de espera.) Custo: 1 chamada `fin124/list` (~160 arquivos, 1 página) + só os arquivos novos/mudados.
Resposta:

**Q17 — o que a conferência rápida faz com cada caso.** (Default:
- arquivo **novo** → lê os itens e grava (mesmo `salvarArquivo`, guarda de lista vazia incluída);
- arquivo que **ganhou `ddcTimCanc`** ou **trocou `ddcVldStatus`/nome** → atualiza **só o cabeçalho**
  (nada de item; arquivo cancelado já sai da aba pelo `cancelado_em`);
- arquivo que **sumiu** da lista → não faz nada (nunca apaga; registra `warn`);
- nada mudou → só grava `conferido_em`.
Mesmo advisory lock do DDA (ocupado → `ocupada`, não espera), mesmo prazo de 60 s, mesmo teto de 3
leituras simultâneas, invalida os caches (sugestões e lista consolidada) só se gravou algo.)
Resposta:

**Q18 — aviso "DDA parado".** (Default: conta a partir de `conferidoEm` (última conversa bem-sucedida
com o fin124), não de `sincronizadoEm`; limiar e regra de dia útil iguais (8 h). Fica **quieto**
enquanto a abertura (carteira/conferência) está rodando: a página passa `atualizandoCarteira` à aba
(1 linha no bloco do `<BoletosDdaTab>`). O cabeçalho mostra "DDA conferido às HH:MM · dados de …". O
GET devolve `conferidoEm` ao lado de `sincronizadoEm`.)
Resposta:

**Q19 — o que fica de fora.** (Default: releitura de 60 dias só no cron/ingestão (como hoje); a
janela por vencimento (F5.2) segue follow-up; nada de cron pago no Render; nada de 202/polling.)
Resposta:
