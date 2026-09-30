# Follow-ups — auth-supabase (ADR-0054)

Não implementados nesta feature. Origem indicada em cada bloco.

## Regis-Review 2026-09-30-1554 (`docs/regis-review/2026-09-30-1554/`, 0 P0, score 7,6)

- [P1] availability-1 — Distinguir indisponibilidade de expiração na renovação de sessão do front (503/429/rede não devem abrir o modal; timeout no fetch do refresh)
- [P2] availability-3 — Formalizar e ensaiar o fallback de login para `AUTH_PROVIDER=local`
- [P2] deployability-1 — Tornar o rollback de código à prova da armadilha D14
- [P2] fault-tolerance-1 — Agendar o `sync-supabase-auth` e alertar em `AUTH_DIVERGENCIA`
- [P2] fault-tolerance-2 — Registrar divergência quando a escrita no GoTrue expira com resultado incerto
- [P2] integrability-1 — Gravar fixtures reais do GoTrue e adicionar smoke de contrato
- [P2] modifiability-1 — Extrair a resolução do provider de auth para um ponto único
- [P2] modifiability-2 — Quebrar `resolverAcesso` em funções menores
- [P2] performance-1 — Compartilhar a consulta de acesso em miss concorrente (single-flight)
- [P2] performance-2 — Reduzir o tempo de conexão presa pela escrita de credencial
- [P2] security-1 — Registrar recusas de login e alarmar sobre elas
- [P2] security-3 — Tornar o bloqueio por identificador menos abusável
- [P2] testability-1 — Fixar pisos de cobertura por arquivo no código de auth
- [P2] testability-2 — Injetar relógio nas decisões de expiração e banimento
- [P2] availability-2 — Alertar sobre `AUTH_INDISPONIVEL` e `AUTH_DIVERGENCIA`
- [P2] availability-4 — Tirar chamadas ao GoTrue de dentro do lock da linha quando possível
- [P2] deployability-2 — Scriptar as verificações do corte
- [P2] modifiability-3 — Dividir `UserRepository` por responsabilidade
- [P2] security-2 — Endurecer a sessão do navegador (CSP e escopo do refresh token)
- [P2] testability-3 — Testes de integração contra `supabase start` e Postgres real para a 0070
- [P3] deployability-3 — Cobrir indisponibilidade do Supabase Auth no runbook (a correção do ADR citado já foi feita)
- [P3] fault-tolerance-3 — Limitar a exposição do pool durante a espera do GoTrue
- [P3] fault-tolerance-4 — Distinguir falha transitória de recusa na renovação de sessão do front
- [P3] integrability-3 — Centralizar a base de URL do frontend de auth
- [P3] performance-3 — Busca direcionada por e-mail no GoTrue
- [P3] security-4 — Revogar o refresh token também com access token expirado
- [P3] security-5 — Fixar data para fechar o caminho HS256 e girar os segredos
- [P3] integrability-2 — Extrair transporte HTTP comum para os próximos clients

## ObservabilityAdvisor (Task 12, 2026-09-30)

- [P2] Logar a recusa do refresh pelo GoTrue (`SupabaseSessionService.refresh`) como `AUTH_SESSAO` warn com o motivo, para medir a taxa de sessões derrubadas
- [P2] Trocar o `console.warn` do 403 em `http/acesso.ts` (`exigirPermissao`) por `LogService.warn` estruturado, buscável junto dos outros eventos de acesso
- [P3] Trocar o literal `'BUSINESS_ERROR'` do login ambíguo (`AuthService` e `SupabaseSessionService`) por uma constante de `LOG_TYPE`
