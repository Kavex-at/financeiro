---
qa: Security
qa_slug: security
run_id: 2026-09-28-2158
agent: qa-security
generated_at: 2026-09-28T21:58:00-03:00
scope: backend, frontend (delta only — feature auth-permissoes-modulo, `4c6b34f..HEAD`)
score: 8.5
findings_count: 4
cards_count: 4
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário autenticado com token válido mas sem a permissão do módulo (ou já desativado/rebaixado pela tela `/usuarios`) | Tenta executar ou consultar uma ação mutável — finalizar lote SISPAG, disparar remessa, atribuir papel, trocar exceção de outro usuário — depois de ter o acesso alterado ou nunca ter tido permissão | As 85 rotas autenticadas do backend, o middleware `resolverAcesso`/`exigirPermissao` (`src/backend/http/acesso.ts`) e o `AccessRepository.lockAndCheck` | Produção, cache de acesso em memória de 30 s, uma única instância web (Render `plan: starter`) | O banco — nunca o token — decide a cada requisição; falha fechada (503) se o banco não responder; usuário desativado ou permissão retirada some do cache em até 30 s (ou na próxima requisição, via invalidação síncrona pós-commit) | 85/85 rotas com exatamente um guard explícito (100%); 0 rotas sem authz; revogação efetiva em ≤ 30 s (antes: até 12 h, a janela aberta da ADR-0051); 10/10 corridas concorrentes de "último gestor" resolvidas com exatamente 1 sucesso + 1 409 |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Rotas autenticadas com exatamente 1 guard explícito | 85/85 (100%) | 100% | ✅ | `src/backend/http/routePermissions.test.ts` (introspecção do `router.stack`) |
| Casos de teste comportamental por rota (403 sem a permissão / passa só com ela) | 346 | ≥ 1 por rota | ✅ | `_shared-metrics.md`; `routePermissions.test.ts` |
| Checagens reais `AccessRepository`/`UserRepository` (Postgres descartável) | 27/27 | 27/27 | ✅ | `_shared-metrics.md` — "Validação ao vivo" |
| Corridas concorrentes "último gestor" (dois gestores se removendo ao mesmo tempo) | 10/10 → sempre 1 sucesso + 1 `LastUserManagerError` (409) | 10/10 sem corrupção de estado | ✅ | `_shared-metrics.md`; `src/backend/domain/repository/auth/AccessRepository.ts:332-372` |
| Janela de revogação de acesso (desativar/rebaixar → efeito) | ≤ 30 s (cache TTL) via tela; até 30 s por SQL direto; fecha a lacuna de até 12 h da ADR-0051 | ≤ 30 s | ✅ | `AccessService.ts:42` (`CACHE_TTL_MS`); `ADR-0053` D4/D5 |
| Ações que mutam `app_user`/acesso cobertas pela trilha `app_user_access_event` | 3/5 (papel, exceção, ativo) — `reset-senha` e vínculo Conexos ficam de fora | 5/5 das mutações de conta | ⚠️ | `src/backend/domain/service/auth/UserAdminService.ts:403-407` (reset), `:357-372` (vínculo) |
| Tentativas negadas (401/403) persistidas com identidade + alertável por limiar | 0 — só `console.warn` efêmero no 403; 401 (sessão encerrada) não loga nada | presente (log persistido + alarme) | ❌ | `src/backend/http/acesso.ts:153-156` (401 sem log), `:185-193` (`console.warn`, não `LogService`) |
| Rotas de Recebimentos que fazem `assertUserCanActOnFilial` contra claim de token nunca provisionado | 9 chamadas, todas fail-open (`filiais` ausente → `true`) | recorte real por filial | ⚠️ (decisão Q12, fora do escopo desta ADR) | `src/backend/http/filialAuthz.ts:37-50`; `src/backend/routes/recebimentos.ts` (9 ocorrências) |
| `npm audit` (dependências) | não coletado nesta rodada | crítico=0, alto=0 | ⚠️ **Não medível nesta rodada `--quick`** | requer `cd src/backend && npm audit` fora do modo rápido |

## 3. Tactics — Cobertura no financeiro (delta `auth-permissoes-modulo`)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | 403 negado loga só via `console.warn` (efêmero, sem `LogService`, sem `requestId` nem agregação); 401 de sessão encerrada não loga nada. Sem limiar/alarme para tentativas repetidas | ⚠️ parcial | `src/backend/http/acesso.ts:153-156,185-193` |
| Detect Service Denial | Fora do escopo desta ADR (rate limiting já existe, não tocado pelo delta) | N/A — não tocado por este delta |  |
| Verify Message Integrity | JWT assinado (HS256/ES256), verificado por `jose` antes de `resolverAcesso` — não tocado por este delta, mas é pré-condição de tudo que segue | ✅ presente (pré-existente) | `src/backend/http/auth.ts` |
| Detect Message Delay | N/A para este domínio (sem replay window nova neste delta) | N/A |  |
| Identify Actors | `sub = username` no token; `AccessRepository.findAccessBySub` casa por `lower(username)` — identidade nunca vem de claim de permissão | ✅ presente | `src/backend/domain/repository/auth/AccessRepository.ts:162-169` |
| Authenticate Actors | Sem mudança nesta ADR (mantém `buildAuthMiddleware`); o novo `resolverAcesso` roda estritamente depois | ✅ presente (pré-existente) | `src/backend/http/buildApp.ts:116-127` |
| Authorize Actors | Autorização sai do claim do token e passa a ser recalculada do banco a cada requisição, com fórmula única (`EffectivePermissionCalculator`) e falha fechada; 85/85 rotas com guard único e testado | ✅ presente — o núcleo desta ADR | `src/backend/http/acesso.ts:108-207`; `EffectivePermissionCalculator.ts` |
| Limit Access | `usuarios:gerenciar` isola toda a gestão de conta num único guard de router (`router.use`); RBAC por módulo substitui o binário admin-para-todos | ✅ presente | `src/backend/routes/usuarios.ts:34` |
| Limit Exposure | Dados sensíveis (CNAB, contas pagadoras, linha digitável) seguem exigindo `sispag:executar`, não apenas `sispag:ver` (JC-3); mantém o padrão de antes | ✅ presente (pré-existente, confirmado pela tabela de rotas) | ADR-0053 D8, JC-3 |
| Encrypt Data | Vínculo Conexos (senha do ERP) segue cifrado via `SecretCipher` — não tocado por este delta | ✅ presente (pré-existente) | `UserAdminService.ts:366` |
| Separate Entities | `AccessService`/`AccessRepository` isolados do `bootstrapAppContainer` compartilhado com os ~58 jobs — evita autorização vazando para o runtime de job | ✅ presente | `AccessService.ts:33-34`; `ADR-0053` D4 |
| Change Default Settings | `DEV_AUTH_BYPASS` deriva um usuário fictício com as nove permissões só quando a env já provou (via `loadAuthEnv`, fail-fast pré-existente) que o ambiente é local/dev; nenhum default perigoso em produção | ✅ presente | `src/backend/http/acesso.ts:59-71`; `authEnv.ts:89-101` |
| Validate Input | Corpo/params de toda escrita de `/usuarios` validado com Zod antes de tocar o serviço; `CHECK` no banco replica o catálogo de permissões (defesa em profundidade banco+app) | ✅ presente | `src/backend/routes/usuarios.ts` (schemas Zod por rota); `migrations/0066...sql:57-72` |
| Revoke Access | Desativar/trocar papel invalida o cache do alvo no mesmo processo (efeito imediato pela tela) e cai para 30 s pelo TTL fora da tela; mas cache é só em memória — não sobrevive a mais de uma instância | ⚠️ parcial | `AccessService.ts:94-99`; ADR-0053 D4 "Ressalva de instâncias" |
| Lock Computer | N/A — não há lockout de conta por tentativa de login neste delta (autenticação não foi tocada) | N/A — fora do escopo do delta |  |
| Inform Actors | 403 devolve o código da permissão faltante ao usuário (UX); nada é enviado a um canal de observabilidade/alerta quando a negativa se repete | ⚠️ parcial | `acesso.ts:193` |
| Restore | Rollback da 0066 documentado e testado ao vivo (aplicar → reverter → reaplicar, idempotente), com exportação da trilha antes de derrubar as tabelas | ✅ presente | `migrations/rollbacks/0066_auth_permissoes_modulo.rollback.sql`; ADR-0053 D12; ver cross-ref com Availability/Deployability |
| Audit Trail | `app_user_access_event` append-only cobre papel/exceção/ativo, com ator, antes/depois, na mesma transação da escrita; mas **não** cobre `reset-senha` nem vínculo Conexos (ambas mutam a conta e, no caso do vínculo, a identidade que age no ERP) | ⚠️ parcial | `AccessRepository.ts:374-387`; `UserAdminService.ts:403-407,357-372`; ver cross-ref com Fault Tolerance |

## 4. Findings (achados)

### F-security-1: Reset de senha e vínculo Conexos ficam fora da trilha de auditoria de acesso

- **Severidade**: P2
- **Tactic violada**: Audit Trail
- **Localização**: `src/backend/domain/service/auth/UserAdminService.ts:403-407` (`resetPassword`), `:357-372` (`setVinculo`); rotas em `src/backend/routes/usuarios.ts:266-322`
- **Evidência (objetiva)**:
  ```ts
  // UserAdminService.ts:403-407
  public resetPassword = async (id: number, password: string): Promise<void> => {
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const ok = await this.userRepository.updatePassword(id, passwordHash);
      if (!ok) throw new Error(`NOT_FOUND: user ${id} not found`);
  };
  // nenhuma chamada a `logarMudanca` / `AccessRepository.recordEvent` — ao contrário de
  // setRole/replaceExceptions/setAtivo, que gravam em app_user_access_event.
  ```
  `ACCESS_EVENT_TYPE` só tem três valores (`papel`, `excecao`, `ativo`) — `AccessRepository.ts:38-43`.
- **Impacto técnico**: um `usuarios:gerenciar` pode redefinir a senha de qualquer conta, inclusive de outro gestor, ou trocar o vínculo Conexos de um usuário (a identidade com que ele assina baixas/permutas no ERP) sem deixar rastro consultável — nem linha na tabela de trilha, nem `LogService`.
- **Impacto de negócio**: numa investigação pós-incidente ("quem trocou minha senha", "por que a baixa saiu no nome de outro analista"), essas duas ações — justamente as duas que mudam QUEM age em nome de quem no ERP financeiro — são as únicas sem resposta no banco. O CLAUDE.md e a proposta tratam trilha auditável de toda ação como não-negociável; esta ADR implementou o framework mas não o estendeu às duas ações mais sensíveis de conta.
- **Métrica de baseline**: 3/5 tipos de mutação de conta cobertos pela trilha (`ACCESS_EVENT_TYPE` tem 3 valores; `usuarios.ts` expõe 5 mutações de conta: papel, exceções, ativo, senha, vínculo).

### F-security-2: Tentativas de acesso negado não são persistidas nem alertáveis

- **Severidade**: P2
- **Tactic violada**: Detect Intrusion / Inform Actors
- **Localização**: `src/backend/http/acesso.ts:153-156` (401 "sessão encerrada"), `:185-193` (403 "sem permissão")
- **Evidência (objetiva)**:
  ```ts
  // 401 — nenhum log, nem console:
  if (!acesso?.ativo) {
      res.status(401).json({ error: MENSAGEM.SESSAO_ENCERRADA });
      return;
  }
  // 403 — só console.warn, sem LogService, sem requestId, sem contagem:
  console.warn(
      `[acesso] negado: usuário '${req.user?.sub ?? 'desconhecido'}' em ${req.method} ` +
          `${req.originalUrl} sem a permissão ${permissao}`,
  );
  ```
  Compare com o caminho de erro do banco (mesma função), que loga via `LogService.error` com `requestId`, `usuario` e `rota` (`acesso.ts:136-145`) — a mesma disciplina não existe para negativas de autorização.
- **Impacto técnico**: um usuário desativado tentando repetidamente uma rota (token ainda não expirado, até 12 h por ADR-0051), ou um analista de SISPAG tentando repetidamente uma rota de `usuarios:gerenciar`, não gera nenhuma linha persistida, agregável em métrica ou alarmável — só um `console.log` que se perde nos logs efêmeros do Render.
- **Impacto de negócio**: elimina a chance de detectar, antes de um incidente, um ex-funcionário ou uma credencial vazada testando limites do sistema financeiro (CNPJs, remessas, permutas) — o sinal existe no código mas não chega a lugar nenhum que dispare um alerta.
- **Métrica de baseline**: 0 tentativas negadas persistidas ou alertáveis; 100% delas (401 e 403) ficam só em log de processo.

### F-security-3: `filialAuthz` continua fail-open por depender de um claim de token nunca emitido (fora do escopo desta ADR, mas amplificado por ela)

- **Severidade**: P2
- **Tactic violada**: Authorize Actors / Limit Exposure
- **Localização**: `src/backend/http/filialAuthz.ts:37-50`; usado em 9 pontos de `src/backend/routes/recebimentos.ts` (linhas 90, 148, 254, 477, 570, 710, 792, 885)
- **Evidência (objetiva)**:
  ```ts
  export const userCanActOnFilial = (user: FilialScopedUser | undefined, filCod: number): boolean => {
      if (!user) return false;
      const permitidas = filiaisPermitidas(user);
      if (permitidas === undefined) return true;   // <- claim nunca provisionado hoje
      return permitidas.includes(filCod);
  };
  ```
  `ADR-0053` D11/Q12 registra explicitamente: "Continua lendo o claim `filiais` do token, o que contraria o I1 desta ADR. Ficou intocado." Nenhum token emitido hoje carrega `filiais` (`src/backend/http/auth.ts:71-81`, `filiaisFromClaims` sempre `undefined` na ausência do claim).
- **Impacto técnico**: as 9 rotas de Recebimentos que movimentam dinheiro por filial (solicitação de numerário, arquivamento de transação) aceitam qualquer `filCod` de qualquer usuário com `recebimentos:executar` — a checagem por filial nunca nega nada na prática atual.
- **Impacto de negócio**: um analista com `recebimentos:executar` de uma filial pode disparar ações em processos de outra filial. A ADR-0053 corrigiu exatamente esse padrão para módulo (via banco); a mesma correção não foi estendida a filial, por decisão explícita de escopo (Q12) — o risco fica documentado, não fica fechado.
- **Métrica de baseline**: 9/9 chamadas de `assertUserCanActOnFilial` em produção resolvem para `true` incondicionalmente (claim `filiais` ausente em 100% dos tokens emitidos hoje).

### F-security-4: Revogação de acesso depende de cache em memória de instância única — sem invalidação distribuída

- **Severidade**: P3
- **Tactic violada**: Revoke Access
- **Localização**: `src/backend/domain/service/auth/AccessService.ts:33-44,94-99`
- **Evidência (objetiva)**:
  ```ts
  // singleton, cache SÓ no processo:
  private readonly cache = new Map<string, CacheEntry>();
  public invalidar = (userId: number): void => {
      for (const [key, entry] of this.cache) {
          if (entry.value.userId === userId) this.cache.delete(key);
      }
  };
  ```
  A própria ADR-0053 (D4, "Ressalva de instâncias") documenta: "Se o número de instâncias subir, a invalidação no processo não alcança as outras, e o pior caso de qualquer mudança feita pela tela passa a ser os 30 s do TTL."
- **Impacto técnico**: com mais de uma instância web, desativar um usuário pela tela invalida o cache só na instância que atendeu a requisição; as demais seguem servindo o acesso antigo por até 30 s (hoje: correto, com 1 instância — `render.yaml: plan: starter`, sem `numInstances`).
- **Impacto de negócio**: nenhum hoje. Vira um TODO de segurança esquecido se o Render escalar horizontalmente sem que alguém revisite esta decisão — o pior caso passa de "imediato" para "até 30 s silenciosos" sem que nenhum teste ou alarme acuse a mudança.
- **Métrica de baseline**: 1 instância web hoje (confirmado); 0 mecanismo de invalidação distribuída (pub/sub, cache compartilhado) existente para quando esse número mudar.

## 5. Cards Kanban

### [security-1] Auditar reset de senha e vínculo Conexos como o resto do acesso

- **Problema**
  > `resetPassword` e `setVinculo` mutam a conta de um usuário — inclusive a identidade que assina baixas e permutas no ERP — sem gravar linha na trilha `app_user_access_event` nem log via `LogService`, ao contrário de papel/exceção/ativo, cobertos pela mesma ADR-0053.

- **Melhoria Proposta**
  > Acrescentar `ACCESS_EVENT_TYPE.SENHA` e `ACCESS_EVENT_TYPE.VINCULO` (migration de dados, sem quebrar o `CHECK` existente) e chamar `AccessRepository.recordEvent` a partir de `UserAdminService.resetPassword` e `UserAdminService.setVinculo`, com o `actorUsername` já disponível nas rotas (`routes/usuarios.ts`). Tactic alvo: Audit Trail.

- **Resultado Esperado**
  > Cobertura da trilha de mutação de conta sobe de 3/5 para 5/5 tipos de ação. Toda mudança de "quem pode agir como quem" no financeiro fica reconstruível por SQL.

- **Tactic alvo**: Audit Trail
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Tipos de mutação de conta cobertos pela trilha: 3/5 → 5/5
  - Chamada de `recordEvent` presente em `resetPassword`/`setVinculo`: 0 → 2
- **Risco de não fazer**: em um incidente de conta comprometida, a pergunta "quem trocou a senha/o vínculo Conexos de fulano, e quando" não tem resposta no banco — só em logs efêmeros do Render, se ainda existirem.
- **Dependências**: nenhuma.

### [security-2] Persistir e alarmar tentativas de acesso negado

- **Problema**
  > 401 (sessão encerrada) não gera nenhum log; 403 (sem permissão) gera só `console.warn`, sem `requestId`, sem `LogService`, sem contagem — ao contrário do caminho de erro do banco na mesma função, que já loga estruturado. Não há como detectar um padrão de tentativas repetidas antes de um incidente.

- **Melhoria Proposta**
  > Trocar o `console.warn` do 403 e acrescentar log no 401 (`LogService.warn`, `LOG_TYPE.BUSINESS_WARN` ou similar) em `src/backend/http/acesso.ts`, com `usuario`, `rota`, `requestId`. Acrescentar uma métrica agregada (contagem por usuário/IP numa janela) e um alarme quando o limiar for cruzado (Painel de Operação, ADR-0042, é o lugar natural). Tactic alvo: Detect Intrusion.

- **Resultado Esperado**
  > 100% das negativas de autorização (401 de sessão encerrada e 403 de permissão) viram log estruturado e persistido; um limiar configurável (ex.: N negativas do mesmo usuário em M minutos) dispara alerta visível no Painel de Operação.

- **Tactic alvo**: Detect Intrusion
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Negativas de acesso persistidas: 0% → 100%
  - Alarme por limiar de negativas repetidas: ausente → presente
- **Risco de não fazer**: um ex-funcionário com token ainda válido (até 12 h) ou uma credencial vazada pode sondar rotas financeiras sem deixar rastro acionável — o sistema só "sabe" que negou, ele não avisa ninguém.
- **Dependências**: nenhuma; pode reusar a infraestrutura do Painel de Operação (ADR-0042).

### [security-3] Fechar o recorte por filial com dado do banco, como as permissões de módulo

- **Problema**
  > `filialAuthz` continua lendo um claim `filiais` que nenhum token emitido hoje carrega, então as 9 checagens de filial em Recebimentos são fail-open na prática — o mesmo padrão (autorização no token) que a ADR-0053 corrigiu para permissão de módulo continua ativo para filial.

- **Melhoria Proposta**
  > Estender o modelo de acesso (`app_user` → tabela `app_user_filial` ou coluna equivalente) e trocar `filiaisFromClaims`/`filialAuthz` para consultar o banco pelo mesmo `AccessService`/`AccessRepository`, em vez do claim do token — replicando o padrão I1 desta ADR (token só identifica, banco autoriza). Tactic alvo: Authorize Actors, com Limit Exposure como consequência (reduz o raio de uma conta comprometida a uma filial).

- **Resultado Esperado**
  > As 9 chamadas de `assertUserCanActOnFilial` deixam de resolver `true` incondicionalmente; um usuário só age nas filiais que o banco autoriza para ele.

- **Tactic alvo**: Authorize Actors (cross-ref: Limit Exposure / Availability — raio de dano de uma conta comprometida)
- **Severidade**: P2
- **Esforço estimado**: L (1–2 sem)
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Chamadas de `assertUserCanActOnFilial` resolvidas por dado do banco (não por claim): 0% → 100%
- **Risco de não fazer**: o "recorte real por frente" que a ADR-0053 entrega para módulo não existe para filial — um analista de uma filial segue podendo agir em processos de outra, silenciosamente.
- **Dependências**: nenhuma diretamente, mas compartilha desenho com o passo 3 do plano de auth (Supabase Auth) — vale desenhar os dois juntos.

### [security-4] Revisitar a invalidação de cache de acesso antes de escalar para mais de uma instância

- **Problema**
  > `AccessService` guarda o acesso resolvido em memória de processo; a invalidação síncrona pós-escrita só alcança a instância que recebeu a escrita. A própria ADR-0053 documenta que, com `numInstances > 1`, o pior caso de uma desativação pela tela deixa de ser "imediato" e passa a ser "até 30 s" nas outras instâncias, sem alarme para acusar a mudança de comportamento.

- **Melhoria Proposta**
  > Antes de qualquer mudança em `render.yaml` que suba `numInstances`, substituir a invalidação in-process por um mecanismo distribuído (pub/sub simples via Postgres `LISTEN/NOTIFY`, já que o banco é a fonte da verdade, ou reduzir o TTL) e adicionar um teste que falhe caso `numInstances` mude sem essa revisão. Tactic alvo: Revoke Access.

- **Resultado Esperado**
  > A garantia "acesso revogado pela tela é efetivo imediatamente" deixa de depender do número de instâncias, ou o time decide conscientemente aceitar até 30 s em todas elas.

- **Tactic alvo**: Revoke Access (cross-ref: Availability — escala horizontal)
- **Severidade**: P3
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-security-4
- **Métricas de sucesso**:
  - Teste/gate que acusa `numInstances > 1` sem invalidação distribuída: ausente → presente
- **Risco de não fazer**: se alguém escalar o Render por motivo de disponibilidade (não relacionado a segurança), a garantia de revogação em 30 s documentada nesta ADR regride silenciosamente para "até 30 s por instância", sem que ninguém tenha decidido isso conscientemente.
- **Dependências**: nenhuma até o dia em que `numInstances` subir; cross-ref com Availability.

## 6. Notas do agente

- Escopo: avaliei só o delta `4c6b34f..HEAD` nos diretórios listados em `_shared-metrics.md`. `filialAuthz` é tratado como achado (F-security-3) por amplificação de risco, não como defeito introduzido por este delta — decisão Q12 da própria ADR-0053 o deixou fora, e a severidade reflete isso (P2, não P0).
- Nenhum P0 encontrado: não há segredo hardcoded, SQL não-parametrizado, rota financeira sem guard, nem regressão de authz introduzida pelo delta — o padrão contrário do que se via antes (token como fonte de autorização) é justamente o que esta ADR corrige.
- `npm audit` não foi coletado (`--quick`); recomendo rodar fora do modo rápido antes do próximo ciclo.
- Cross-QA para o consolidador: Audit Trail (F-security-1) sobrepõe Fault Tolerance; Revoke Access (F-security-4) sobrepõe Availability (escala horizontal) e Deployability (mudança de `numInstances` no `render.yaml`); Limit Exposure (F-security-3) sobrepõe Availability (raio de dano por filial).
