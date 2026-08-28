# Follow-ups — `conexos-fallback-audit` (NÃO implementados)

Delta da branch `fix/conexos-fallback-audit` (ADR-0041). Origem: `/investigate` de 2026-08-25 +
`/feature-tweak` de 2026-08-28.

## Segurado pelo Yuri (decisão explícita, não é achado de gate)

| # | Item | Por que ficou de fora |
|---|------|------------------------|
| F-1 | Declarar `CONEXOS_CRED_ENC_KEY` no `render.yaml` (`sync: false`) e no `src/backend/.env.example` | Levantado na investigação e **adiado pelo Yuri** neste ciclo. Não afeta produção (a chave está setada lá, senão o cadastro de vínculo teria falhado no `encrypt`). Afeta **todo ambiente que não seja produção**: sem a chave, `SecretCipher.isEnabled()` → `false`, a coluna Conexos some da tela de Usuários, e **todo** vínculo degrada para o robô — silenciosamente antes deste delta, agora com `warn`. Reproduzido em 2026-08-25: `testarVinculo` devolveu `falha` para os dois usuários vinculados rodando contra o `.env` local. |

## Causa-raiz operacional (fora do código, com o time)

| # | Item | Estado |
|---|------|--------|
| F-2 | Descobrir por que a credencial de `MARILYN_MUTAFCI` não completa `POST /login` no Conexos | Yuri comunicaria ao time. Senha incorreta, conta bloqueada e limite de sessões produzem o mesmo sintoma; o `warn` de I-1 agora distingue `decrypt` de `login`, mas não distingue as causas *dentro* de `login`. Diagnóstico: `GET /me/conexos-status` como o usuário, e a presença/ausência de `columbia:user:MARILYN_MUTAFCI` em `conexos_sessions`. |

## Dívida assumida por este delta

| # | Item | Nota |
|---|------|------|
| F-3 | As 35 execuções históricas de `MARILYN_MUTAFCI` (e todas as linhas anteriores à migration `0051`) ficam com `conexos_username`/`conexos_usn_cod` NULL | Sem backfill por decisão da ADR-0041: a identidade usada no passado não está gravada em lugar nenhum, e inferi-la do vínculo atual poluiria a trilha com um palpite. NULL significa "não capturada". |
| F-4 | O `warn` de I-1 sai **uma vez por request** que degrada, não uma vez por usuário/dia | Deliberado: sem estado, sem dedup. Se virar ruído em produção, o passo natural é uma métrica com dimensão `conexosUsername` em vez de log por request. |
| F-5 | Nenhum alarme/painel consome o `warn` ainda | Este delta fecha a lacuna de **registro**; a de **notificação** continua aberta. Um alarme sobre `BUSINESS_WARN` + `motivo in (decrypt, login)` seria o próximo passo. |

## Gates

- **PatternGuardian** — verificado inline (Rules #5 SQL parametrizado, #7 decorators, #8
  `EnvironmentProvider` em vez de `process.env`, #9 modificadores/arrow/classes). Sem achado.
  Observação: `getCapturedUsnCod()` em `services/conexos.ts` segue o estilo do arquivo legado
  (método comum, sem modificador explícito) em vez do padrão DDD — coerente com o entorno.
- **DesignSystemReviewer** — não aplicável: `src/frontend/` não foi tocado.
- **Ground-Truth Validation** — não aplicável: nenhuma lógica monetária, fórmula, sinal,
  classificação ou filtro de fetch financeiro mudou. O delta é auditoria e observabilidade.
- **Regis-Review** — **não executado** nesta sessão (o pipeline exige subagentes; a configuração
  desta sessão veta spawn de agentes sem pedido explícito). Pendente de decisão do Yuri.
