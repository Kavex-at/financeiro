# Follow-ups — painel-operacao (ADR-0042)

> Aberto em 2026-09-01, ao fim do ciclo `/feature-new`. Nada aqui bloqueia a entrega.
> Gates: **SpecVerifier APROVADO** (35 critérios, 0 reprovados) · **PatternGuardian** 6 achados
> (2 rejeitados com justificativa, 4 viram a nota #4 abaixo) · **DesignSystemReviewer** 3 achados
> (1 rejeitado, 1 aplicado, 1 vira #3).

---

## P1 — os pontos cegos que este slice NÃO fecha

### 1. Dead-man's switch externo (fecha DOIS pontos cegos de uma vez)

A ADR-0042 nomeia duas lacunas que têm a MESMA solução:

- o detector de staleness roda no próprio GitHub Actions e não vê o Actions parar de disparar;
- `DbAlertSink` não consegue alertar que o backend caiu — se o processo não sobe, ninguém escreve a
  linha.

Encaminhamento: expor `GET /health/pipelines` (read-only, sem auth ou com token) devolvendo a idade
da última run de cada pipeline, e apontar um pinger externo (healthchecks.io, cronitor) para ele,
configurado para alertar tanto no não-200 quanto na AUSÊNCIA do ping.

Mitigação parcial já entregue: **I6** — o painel computa staleness na leitura, então um humano que
abra a tela vê a verdade mesmo numa janela em que o detector não rodou.

### 2. O reaper não tem trilha de execução

`jobs/reaper-sispag-reconciling.ts` não escreve linha de run — é o único job que o painel não
consegue vigiar por staleness, e é justamente aquele cuja cegueira já estava documentada por escrito
no comentário do próprio workflow ("uma queda na sexta à noite ficaria invisível até segunda").

Hoje ele aparece LISTADO como `sem-trilha` (nunca omitido) e ganhou alerta de falha de workflow
(T7), o que recupera parte da cegueira — mas um reaper que roda e não faz nada de útil segue
invisível.

**O destino já existe:** basta ele passar a escrever em `job_execucao` (migration `0053`) via
`JobExecucaoRepository`, exatamente como `reconciliar-nde-sefaz.ts` faz. É trabalho pequeno e
aditivo; não entrou aqui só por ser escopo de outra frente.

---

## P2

### 3. `scope="col"` ausente em TODAS as tabelas do app

`components/ui/table.tsx` renderiza `<th>` sem `scope`, e nenhuma página do repositório o define
(`recebimentos`, `sispag`, `permutas` — todas com 0 ocorrências). É requisito WCAG 2.1 AA segundo o
próprio `docs/design-system/accessibility.md`.

O conserto certo é **uma linha em `TableHead`**, que corrige o app inteiro de uma vez — e é
justamente por ser app-wide que não entrou numa fatia de feature. As tabelas de `/operacao` já
receberam `aria-label`, que era a parte que cabia aqui.

### 4. ~~CLAUDE.md manda logar em inglês; o código loga em português~~ — **RESOLVIDO 2026-09-01**

Contradição **do repositório**, não deste slice. Medido: **39 de 91** mensagens de `LogService` em
`domain/service/` tinham marcas de português (`'remessa gerada'`, `'falha ao gerar remessa'`,
`'conciliação já processada'`), e os jobs existentes logam `início`, `lidas`, `deduplicadas`.

O PatternGuardian levantou 5 achados de idioma contra os arquivos novos. Tratá-los isoladamente
faria destes os únicos arquivos em inglês do repositório — trocaria uma inconsistência declarada por
uma real.

**Decisão (Yuri, 2026-09-01): o CLAUDE.md passa a refletir a prática.** A seção `Conventions →
Language` foi reescrita: identificadores, tipos de erro e commits em inglês; mensagens de log e de
erro voltadas ao operador em português, porque é a língua de quem lê o log durante um incidente.
Uma regra que 40% do código viola faz todo gate gastar tempo com falso-positivo.

Consequência: os 5 achados do PatternGuardian deixam de ser achados. Nenhuma normalização
retroativa é necessária.

### 5. Rota resolve `Repository` direto, sem `Service` no meio

`routes/operacao.ts` resolve `AlertaRepository` para duas operações triviais (listar abertos,
reconhecer). O `CLAUDE.md` descreve a cadeia `route → Service → Repository`.

**Rejeitado como defeito deste slice:** é o padrão vigente — `routes/permutas.ts` resolve
`PermutaSnapshotRepository`, `ClienteFiltroRepository`, `PermutaRelationalRepository` e
`PermutaProcessamentoRepository` da mesma forma. Um `AlertasService` de passagem pura acrescentaria
uma camada sem comportamento e faria um arquivo divergir de todos os vizinhos.

Vale como pergunta de arquitetura para o repositório inteiro (leituras finas podem pular o Service?),
não como correção pontual.

---

## P3

### 6. Deep-linking da aba de `/operacao`

`patterns.md §3` manda a aba ativa ir para a URL. Hoje é estado local. Numa tela de incidente,
compartilhar o link já apontando para a aba certa tem valor real — só não é bloqueante.

### 7. Sem validação Zod no boundary do front

`fetchOperacao()` faz cast do JSON para `OperacaoPainel` sem validar. Nenhuma lib do front usa Zod
hoje (`lib/recebimentos.ts`, `lib/api.ts`, `lib/sispag.ts` — todas fazem cast), então adotar aqui
sozinho divergiria. Mesma natureza do item 4: decisão de repositório.

### 8. `partial` no `pagamento_ingestao_run` (SISPAG)

A fonte do SISPAG fecha `success` mesmo com filial falhada, então uma run com filial quebrada é
indistinguível de uma limpa. O read-model NÃO inventa o estado e carrega a ressalva até a tela
(`distinguePartial: false`, com aviso na coluna).

Corrigir exige tocar um writer vivo — exatamente o que a ADR-0042 decidiu não fazer neste ciclo.

---

## Rejeitados (com justificativa registrada)

| Achado | Origem | Por quê |
|---|---|---|
| "Usar `DataTable` em vez de `<table>` cru" | DesignSystemReviewer | **`DataTable` não existe neste repositório.** O que se usa é o compound `Table` do próprio design system, igual a todas as outras páginas. |
| "Criar `AlertasService` entre rota e repositório" | PatternGuardian | Ver item 5 — contraria o padrão vigente em `routes/permutas.ts`; viraria camada sem comportamento. |

## Validado ao vivo (não é follow-up, é registro)

- Migrations `0052` e `0053` **aplicadas de fato** contra Postgres 16 local; schema conferido.
- **Dedup provado no banco**, não só no mock: dois `INSERT ... ON CONFLICT (dedup_key) DO NOTHING`
  idênticos → 1 linha, e o segundo devolve 0 linhas — que é exatamente o sinal de que
  `AlertaRepository.criarSeNovo` depende para devolver `null`.
