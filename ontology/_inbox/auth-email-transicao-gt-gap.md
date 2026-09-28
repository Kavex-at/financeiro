# Ground-truth — auth-email-transicao

**Veredito: `SEM_GROUND_TRUTH`** (não bloqueia).

A feature não calcula nem agrega valor monetário e não lê nem escreve no Conexos, na Nexxera ou no GED.
Não existe ficha em `ontology/ground-truths/` aplicável, e nenhuma seria: o que ela muda é o login e a
gestão de usuários da própria plataforma.

## O que substitui o gate

O risco desta feature é de **identidade**, não de valor. A invariante I1 (o `sub` do token continua
sendo o `username` canônico) foi coberta assim:

- `AuthService.test.ts`: login pelo e-mail de um usuário com `username = 'admin'` produz um token cujo
  payload decodificado tem exatamente `sub`, `role`, `aud`, `iat` e `exp`, com `sub === 'admin'` e sem
  `email`.
- Validação ao vivo das queries contra um Postgres 16 descartável (container local, nunca o banco de
  produção), com as 65 migrations aplicadas do zero: login sem distinção de caixa, colisões cruzadas
  (409), no-op do mesmo e-mail sem reescrever a trilha, os dois índices em `lower()` barrando duplicata
  de caixa (23505), guarda da migration abortando com dois `username` iguais sem caixa, reexecução
  idempotente da 0064 e a corrida de dois admins se desativando ao mesmo tempo (um passa, o outro
  recebe "último admin", resta um admin ativo).
