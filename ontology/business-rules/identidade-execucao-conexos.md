# Business Rule — Identidade Conexos de uma execução (quem, no ERP, realizou a escrita)

> Toda escrita nossa no Conexos sai sob **uma** identidade do ERP: a do usuário logado (quando ele tem
> vínculo Conexos válido) ou a do **robô** (`CONEXOS_USERNAME`). Quem decide é o
> `ConexosSessionResolver`, por request. Esta regra não muda a decisão — ela exige que a decisão seja
> **observável** e fique **registrada**. Ver ADR-0041 e `integrations/conexos.md` (§ Identidade da sessão).

## O fallback para o robô é legítimo — e continua silencioso para o usuário

O resolver cai no robô em quatro situações, todas esperadas:

1. fora de request (jobs, crons, scripts) — não há usuário;
2. usuário sem vínculo Conexos;
3. senha do vínculo não decifra (chave ausente/trocada);
4. o login Conexos do usuário falha (credencial inválida, conta bloqueada, limite de sessões).

**O fallback NUNCA bloqueia a operação.** Degradar para o robô é preferível a derrubar uma baixa no meio.
O aviso ao usuário permanece onde já estava: no login (`/me/conexos-status` → banner persistente quando
`falha`). Em runtime, o usuário não é interrompido.

## I-1 — Um fallback com vínculo presente é um evento operacional, não um silêncio

Quando o usuário **tem** vínculo e mesmo assim cai no robô (casos 3 e 4 acima), o resolver **DEVE** emitir
um `warn` estruturado com, no mínimo: `platformUsername`, `conexosUsername` e o **motivo** (`decrypt` ou
`login`), incluindo a mensagem do erro original.

Os casos 1 e 2 (sem request, sem vínculo) são o caminho normal e **não** geram log — seriam ruído.

**Por quê.** Até 2026-08-25 os três `catch` do `resolveForUser` eram mudos. Um usuário com vínculo cuja
credencial não logava operava meses pelo robô sem nenhum rastro em lugar nenhum: nem log, nem métrica, nem
coluna. O incidente que originou esta regra só foi diagnosticado por ausência de linha em
`conexos_sessions` — evidência indireta, e por acaso.

## I-2 — A execução registra a identidade Conexos que a realizou

Todo ledger write-ahead de escrita no ERP grava, junto do `executado_por` (o usuário **da plataforma**),
a identidade **do ERP** efetivamente usada:

| Coluna | Conteúdo |
|--------|----------|
| `conexos_username` | login Conexos da sessão que executou (ex.: `MARILYN_MUTAFCI` ou o robô) |
| `conexos_usn_cod`  | `usnCod` capturado no `/login` — é o que o ERP grava do lado dele |

Ledgers cobertos (**seis**): `permuta_alocacao_execucao`, `solicitacao_numerario_execucao`,
`recebimento_execucao`, `remessa_execucao`, `conciliacao_execucao` e `solicitacao_numerario`.

> **A sexta não tem `_execucao` no nome.** `solicitacao_numerario` (migration 0032,
> `NumerarioExecucaoRepository`, alcançável por `routes/permutas.ts`) é write-ahead como as outras e
> guarda a cadeia com299 → fin014 → com297 da trilha de PERMUTA. Ficou de fora da primeira versão
> deste delta porque a lista foi montada pelo padrão de nome — o Regis-Review pegou (modifiability-2
> e fault-tolerance-1, independentemente). Quem adicionar uma sétima: o critério é **"guarda escrita
> irreversível no ERP"**, não o sufixo.

- **Nulo é permitido** e significa "identidade não capturada" — linhas anteriores à migration, e execuções
  `dry_run` que não chegam a resolver sessão. Nulo **não** significa robô.
- A identidade é a **resolvida no momento da escrita**, publicada pelo resolver no contexto da request.
  Nunca é reconstruída depois a partir do vínculo do usuário: o vínculo muda, a execução é histórica.

**Por quê.** Sem I-2, `executado_por = 'marilyn.mutafci@kavex.com'` e o ERP registrando o robô são duas
verdades que não se cruzam. Não havia como responder "esta baixa saiu no nome de quem?" sem abrir o
Conexos linha a linha — e nenhuma forma de auditar retroativamente quantas saíram erradas.

## Fora de escopo

- **Não** bloquear a execução quando a identidade não é a do usuário (decisão explícita, ADR-0041).
- **Não** avisar o usuário por-ação de que a execução saiu pelo robô — o banner de login já cobre.
- **Não** fazer backfill das linhas históricas: a identidade usada no passado não é recuperável.

## Implementação

- `src/backend/domain/client/ConexosSessionResolver.ts` — I-1 (logs) + publicação da identidade.
- `src/backend/domain/libs/requestContext/ConexosRequestContext.ts` — carrega a identidade resolvida.
- `src/backend/migrations/0051_execucao_identidade_conexos.sql` — I-2 (colunas).
- Os seis repositórios de execução — persistem as colunas.
