# Regis-Review follow-ups — auth-permissoes-modulo

> Regis-Review `--quick` de 2026-09-28 (run `docs/regis-review/2026-09-28-2158-auth-permissoes-modulo/`,
> cards completos em `KANBAN.md`). Overall 7.0/10. **0 P0** — nada re-entra no loop. P1/P2/P3 abaixo
> NÃO foram implementados nesta feature. Card id entre parênteses.

## P1

- [P1] Retry curto (RetryExecutor) na consulta de acesso por requisição antes do 503 (availability-2)
- [P1] Dar ao /operacao uma via de acesso que sobreviva à degradação do Postgres (availability-3)
- [P1] Unificar o catálogo de permissões numa fonte única, com paridade FE↔BE testada (modifiability-1, integrability-1)
- [P1] Tirar a dependência de AccessRepository sobre EffectivePermissionCalculator (modifiability-2)
- [P1] Single-flight no AccessService: coalescer consultas concorrentes em cache miss (performance-1)
- [P1] Gravar em app_user_access_event a reativação/reatribuição feita pelo seed-admin (fault-tolerance-2)
- [P1] Harness de integração em CI para a migration 0066 e a guarda R9 — 2ª recorrência (testability-1)
- [P1] Distinguir "indisponível" de "sem permissão" no front, com retry curto em /me/permissoes (availability-1)
- [P1] Coordenar migrations NOT NULL com os crons do GitHub Actions que rodam npm run migrate (deployability-1)
- [P1] Identidade de serviço para o kavex-report-ciclo gerenciada pelo sistema de permissões (integrability-2)
- [P1] Tornar atômica (ou compensada) a edição papel + exceções do EditarAcessoDialog (fault-tolerance-1)

## P2

- [P2] Logar a falha de /me/permissoes no front (availability-4)
- [P2] Runbook de rollback: caso "coluna NOT NULL sem default" (deployability-2)
- [P2] Listar os sítios que tratam sub como username antes do passo 3 (Supabase Auth) (integrability-3)
- [P2] Generalizar usePodeExecutarPermutas para as três frentes (modifiability-3)
- [P2] Derivar as contagens por mount do teste de rotas da própria tabela (modifiability-4)
- [P2] Trilhar reset de senha e vínculo Conexos como o resto do acesso (security-1)
- [P2] Persistir e alarmar negativas 401/403 com LogService e requestId (security-2)
- [P2] Recorte por filial lido do banco, como as permissões de módulo — filialAuthz fail-open (security-3)
- [P2] Trocar fakes de transação por regex-sobre-SQL por dublê de contrato (testability-2)
- [P2] Proteger a introspecção de rotas contra upgrade de major do Express (testability-3)
- [P2] Tornar a invariante "1 instância web" testável ou alertável (deployability-3)
- [P2] Exercitar os reverses de migration (inclusive 0066) em CI contra Postgres real (deployability-4)
- [P2] Reduzir o escopo do lock FOR UPDATE em lockAndCheck (performance-2)

## P3

- [P3] Externalizar CACHE_TTL_MS via EnvironmentProvider (modifiability-5)
- [P3] Paginar GET /usuarios ou documentar a isenção (performance-3)
- [P3] Automatizar/testar o export da trilha antes do rollback da 0066 (fault-tolerance-3)
- [P3] Teste por propriedade para EffectivePermissionCalculator (testability-4)
- [P3] Subir o piso de cobertura de ./lib/auth/ no front (testability-5)
- [P3] Invalidação de cache distribuída antes de escalar para mais de uma instância (security-4)

## Fora dos cards (achados do loop)

- [P3] Atualizar menções antigas a requireRole em ontology/actions/* , integrations/conexos.md e ui-flows/relatorios-export.md (docs sweep)
