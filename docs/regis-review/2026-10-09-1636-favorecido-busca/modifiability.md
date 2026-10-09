---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-09-1636-favorecido-busca
agent: qa-modifiability
generated_at: 2026-10-09T16:50:00-03:00
scope: all
score: 7
findings_count: 4
cards_count: 3
---

# Modifiability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor Kavex | O HML/produção revela que o `#LIKE` do `cmn025` é "começa com" (ou que `pdcDocFederal` é guardado em outro formato) e a busca de favorecido precisa mudar | `ConexosSispagClient.buscarPessoas`, `PayeeSearchService`, `SolicitarAutorizacaoDialog` | Desenvolvimento, com a feature já em produção | Troca localizada de filtro/ordem de leituras sem tocar rota, schema nem tela | Arquivos tocados ≤ 2 (cliente + teste); 0 mudança de contrato HTTP; PR ≤ 1 dia |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC `PayeeSearchService.ts` (novo) | 85 | ≤ 150 | ✅ | `wc -l` |
| LOC `AuthorizedPayeeService.ts` (+18 no delta) | 677 | ≤ 600 | ⚠️ | `wc -l` (já acima antes do delta; 659 em main) |
| LOC `ConexosSispagClient.ts` (+107 no delta) | 935 | ≤ 600 | ❌ | `wc -l` (828 em main) |
| LOC `routes/sispag.ts` (+33) | 1252 | ≤ 600 | ❌ | `wc -l` |
| LOC `frontend/lib/sispag.ts` (+48) | 1721 | ≤ 600 | ❌ | `wc -l` |
| LOC `SolicitarAutorizacaoDialog.tsx` (reescrito) | 444 (era ~108) | ≤ 400 | ⚠️ | `wc -l` |
| Warnings de complexidade cognitiva (≥15) nos arquivos do delta | 0 | 0 | ✅ | `_shared-metrics.md` (lint: 87 warnings pré-existentes, nenhum no delta) |
| Imports `PayeeSearchService.ts` | 7 | ≤ 15 | ✅ | `grep -c '^import'` |
| Imports `routes/sispag.ts` | 40 | ≤ 15 | ❌ | `grep -c '^import'` (hotspot pré-existente, +1 no delta) |
| Imports do diálogo novo | 8 | ≤ 15 | ✅ | `grep -c '^import'` |
| Fan-in `PayeeSearchService` (não-teste) | 1 (routes) | n/a | ✅ | `grep -rlE "/PayeeSearchService\.js'"` |
| Fan-in `AuthorizedPayeeService` | 3 | n/a | ✅ | idem |
| Fan-in `ConexosSispagClient` | 20 | n/a | ⚠️ (ripple amplo, mas delta só adiciona método) | idem |
| Violações de camada no delta (rota → repositório/cliente direto) | 0 novas; `routes/sispag.ts` já importa 3 repositórios e o cliente (pré-existente, linhas 7–12) | 0 | ⚠️ | `grep "domain/client\|domain/repository" routes/sispag.ts` |
| Dependência cíclica no delta | 0 (service → client/repository/mask/env; sem retorno) | 0 | ✅ | inspeção manual 2 saltos |
| Números mágicos novos | 2 (`BUSCA_PESSOAS_LIMITE=20`, `TEXTO_MINIMO=3`), ambos constantes nomeadas e duplicadas entre camadas (3 também no frontend) | configuráveis ou compartilhadas | ⚠️ | `ConexosSispagClient.ts`, `PayeeSearchService.ts` |
| Drift ontologia | `_index`/`_coverage` atualizados no delta (v0.39.0); ação `buscar-favorecido-conexos.md` criada | 0 | ✅ | `git status` |

### Apêndice A — Top-10 maiores arquivos (não-teste, backend + frontend)

| # | Arquivo | LOC |
|---|---|---|
| 1 | src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts | 2415 |
| 2 | src/frontend/lib/sispag.ts | 1721 |
| 3 | src/backend/domain/service/sispag/RemessaService.ts | 1701 |
| 4 | src/frontend/app/sispag/page.tsx | 1492 |
| 5 | src/backend/domain/client/ConexosGerDocProcessoClient.ts | 1300 |
| 6 | src/backend/routes/sispag.ts | 1252 |
| 7 | src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts | 1231 |
| 8 | src/backend/domain/service/permutas/EleicaoPermutasService.ts | 1143 |
| 9 | src/backend/domain/repository/sispag/LotePagamentoRepository.ts | 1099 |
| 10 | src/backend/domain/client/ConexosSispagWriteClient.ts | 1090 |

Tocados pelo delta: #2, #6 (e `ConexosSispagClient.ts`, 935, fora do top-10).

### Apêndice B — Fan-in (importadores não-teste)

Medido só para os módulos do delta e um comparativo; a varredura completa de `domain/service/*` não foi feita (escopo delta).

| # | Módulo | Importadores |
|---|---|---|
| 1 | ConexosSispagClient | 20 |
| 2 | AuthorizedPayeeService | 3 |
| 3 | RemessaService (comparativo) | 2 |
| 4 | PayeeSearchService (novo) | 1 |

⚠️ **Não medível localmente**: top-10 de fan-in repo-wide e ciclos via `madge` (ferramenta não instalada; varredura fora do escopo delta). Recomendação: rodar `npx madge --circular --extensions ts src/backend` no próximo ciclo completo.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | Busca nasceu em serviço próprio (`PayeeSearchService`, 85 LOC) em vez de inflar `AuthorizedPayeeService`. Mas o método foi para um cliente de 935 LOC e a rota para um arquivo de 1252 | ⚠️ parcial | `PayeeSearchService.ts`; `ConexosSispagClient.ts` 828 → 935 |
| Increase Semantic Coherence | Serviço de busca read-only com 1 verbo (`buscar`), toca 1 entidade (FavorecidoAutorizado) + leitura de cadastro. `destinoAtual` coerente com o serviço de pedido | ✅ presente | `PayeeSearchService.ts:41-84` |
| Encapsulate | Mascaramento só no serviço (`MaskDestino`); documento cru não sai do backend; cliente devolve `PessoaCadastro` tipado, não o row do ERP | ✅ presente | `PayeeSearchService.ts:75`; `mapPessoa` |
| Use an Intermediary | `ConexosSispagClient` isola o `cmn025/list`; Zod no limite (`pessoaRowSchema`) | ✅ presente | `ConexosSispagClient.ts` (`mapPessoa`) |
| Restrict Dependencies | Camadas respeitadas no código novo (rota → service → client/repository). Rota continua importando repositórios/cliente (legado) | ⚠️ parcial | `routes/sispag.ts:7-12` |
| Refactor | Regra de classificação do termo (CPF/CNPJ × código × texto) existe duas vezes: regex `soDigitos` no serviço e `digitos`/`length` no cliente | ⚠️ parcial | `PayeeSearchService.ts:46-47`; `ConexosSispagClient.buscarPessoas` |
| Abstract Common Services | `listGenericPaginated`/`runWithRetry` reutilizados; `MaskDestino` reutilizado | ✅ presente | `buscarPessoas` |
| Defer Binding | Limite 20, mínimo 3 letras e debounce 350 ms são constantes em 3 camadas, não configuração; filial vem de `EnvironmentProvider` (`sispagCadastroFilCod`). Sem polimorfismo (um só provedor de cadastro) | ⚠️ parcial | `BUSCA_PESSOAS_LIMITE`, `TEXTO_MINIMO` |

## 4. Findings (achados)

### F-modifiability-1: Regra de classificação do termo de busca duplicada entre serviço e cliente

- **Severidade**: P2
- **Tactic violada**: Refactor (Increase Semantic Coherence)
- **Localização**: `src/backend/domain/service/sispag/PayeeSearchService.ts:46-47`; `src/backend/domain/client/ConexosSispagClient.ts` (`buscarPessoas`, início)
- **Evidência (objetiva)**:
  ```
  service: const soDigitos = /^[\d.\-/\s]+$/.test(limpo); if (!soDigitos && limpo.length < TEXTO_MINIMO) ...
  client : const digitos = limpo.replace(/[.\-/\s]/g, ''); if (/^\d+$/.test(digitos) && (length === 11 || 14)) ...
  ```
- **Impacto técnico**: duas definições de "o que é documento/código/texto"; mudar uma (ex.: aceitar CNPJ alfanumérico, previsto na regra da Receita para 2026) sem a outra faz o serviço filtrar o que o cliente aceitaria.
- **Impacto de negócio**: busca de favorecido silenciosamente vazia para um formato novo; retrabalho de diagnóstico.
- **Métrica de baseline**: 2 sítios com regex de classificação; 3 se contar o frontend (mínimo de 3 letras).

### F-modifiability-2: Hotspots de tamanho recebem mais delta

- **Severidade**: P2
- **Tactic violada**: Split Module
- **Localização**: `ConexosSispagClient.ts` (935), `routes/sispag.ts` (1252, 40 imports), `frontend/lib/sispag.ts` (1721)
- **Evidência (objetiva)**:
  ```
  wc -l: 935 / 1252 / 1721 (alvo máx. 600); delta +107 / +33 / +48
  ```
- **Impacto técnico**: cada feature SISPAG reabre os mesmos três arquivos; conflito de merge e custo de leitura crescem (o cliente cresceu 13% neste delta).
- **Impacto de negócio**: ciclos paralelos de SISPAG colidem; a lição "versão colide entre sessões" tende a se repetir em código.
- **Métrica de baseline**: 3 arquivos > 900 LOC tocados por um delta de ~190 LOC de produção. Sem P1 por ser dívida pré-existente e o delta ter ficado dentro do padrão local.

### F-modifiability-3: Parâmetros de negócio da busca fixos em código, em três camadas

- **Severidade**: P3
- **Tactic violada**: Defer Binding
- **Localização**: `ConexosSispagClient.ts` (`BUSCA_PESSOAS_LIMITE = 20`), `PayeeSearchService.ts` (`TEXTO_MINIMO = 3`), diálogo (3 letras, 350 ms)
- **Evidência (objetiva)**: 3 valores literais replicados backend/frontend; mudança = redeploy dos dois.
- **Impacto técnico**: ajuste fino após a medição do `#LIKE` exige edição em múltiplos arquivos e deploy.
- **Impacto de negócio**: baixo; valores estáveis e nomeados.
- **Métrica de baseline**: 3 constantes, 2 deploys (BE+FE) por ajuste.

### F-modifiability-4: Semântica do ERP (`#LIKE`, formato de `pdcDocFederal`) não medida, mitigada por design

- **Severidade**: P3
- **Tactic violada**: Defer Binding
- **Localização**: `ConexosSispagClient.buscarPessoas` (fallback `formatarDocumento`, duas leituras de texto)
- **Evidência (objetiva)**: `_shared-metrics.md`: semântica não medida ao vivo; documentada no JSDoc ("a busca acha menos, mas não erra").
- **Impacto técnico**: a estratégia de leitura está presa no cliente, porém bem isolada: a correção após a medição fica em um método.
- **Impacto de negócio**: baixo; degradação é "menos resultados", não erro.
- **Métrica de baseline**: 1 método a alterar; 1–3 leituras ao ERP por termo.

## 5. Cards Kanban

### [modifiability-1] Centralizar a classificação do termo de busca em um único módulo

- **Problema**
  > A decisão "documento (11/14 dígitos), código ou texto" e o mínimo de 3 letras existem no `PayeeSearchService` e no `ConexosSispagClient.buscarPessoas` com regex diferentes. Um novo formato de documento exige mudar dois lugares em sincronia.

- **Melhoria Proposta**
  > Refactor: extrair `classificarTermoBusca(termo)` (retorna `{tipo: 'documento'|'codigo'|'texto', valor}`) para `domain/libs/sispag/` e usá-lo no serviço (guarda de mínimo) e no cliente (escolha do filtro). Cobrir com teste tabelado.

- **Resultado Esperado**
  > Uma única definição; adicionar formato de documento toca 1 arquivo + teste.

- **Tactic alvo**: Refactor
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Sítios com regex de classificação no backend: 2 → 1
- **Risco de não fazer**: divergência silenciosa quando o CNPJ alfanumérico entrar em produção.
- **Dependências**: nenhuma.

### [modifiability-2] Extrair as leituras de cadastro do `ConexosSispagClient` e as rotas de favorecidos do `routes/sispag.ts`

- **Problema**
  > O cliente tem 935 LOC e a rota 1252 LOC/40 imports; este delta somou 107 e 33 linhas aos dois. Toda feature SISPAG reabre esses arquivos.

- **Melhoria Proposta**
  > Split Module: mover `buscarPessoas`/`mapPessoa`/`pessoaRowSchema` para `ConexosCadastroPessoaClient` (mesmo `ConexosBase`), e criar `routes/sispag.favorecidos.ts` montado no router principal. Aproveitar no próximo `/feature-tweak` que tocar o arquivo (migração proporcional).

- **Resultado Esperado**
  > `ConexosSispagClient` ≤ 830 LOC no curto prazo; `routes/sispag.ts` perde o bloco de favorecidos.

- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - LOC `ConexosSispagClient.ts`: 935 → ≤ 830
  - Imports `routes/sispag.ts`: 40 → ≤ 30
- **Risco de não fazer**: os três arquivos passam de 1000/1400/1900 LOC em seis meses, com mais conflito entre sessões paralelas.
- **Dependências**: nenhuma.

### [modifiability-3] Compartilhar constantes da busca (limite, mínimo de letras) entre backend e frontend

- **Problema**
  > Mínimo de 3 letras e limite de 20 linhas estão replicados; o frontend não sabe o limite do backend e depende do campo `truncado`.

- **Melhoria Proposta**
  > Defer Binding: expor `minimoTexto` e `limite` na resposta da busca (ou em `/sispag/config`), e o diálogo ler daí. Debounce permanece local (UX).

- **Resultado Esperado**
  > Ajuste pós-medição do `#LIKE` em 1 deploy (backend).

- **Tactic alvo**: Defer Binding
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-3, F-modifiability-4
- **Métricas de sucesso**:
  - Deploys para mudar o mínimo de letras: 2 → 1
- **Risco de não fazer**: baixo; valores divergem se alguém mudar só um lado.
- **Dependências**: medição ao vivo do `#LIKE` (gap conhecido).

## 6. Notas do agente

- Escopo: delta da branch. Fan-in repo-wide e `madge` não rodados (fora do escopo; ferramenta ausente). Fan-in medido com sufixo `.js'` porque os imports ESM do repo usam extensão.
- Cross-QA: Split Module em `routes/sispag.ts`/cliente toca Testability (arquivos grandes = suítes grandes) e Integrability (Encapsulate do cliente Conexos); constantes de busca em código tocam Deployability (mudança = redeploy BE+FE).
- Nenhum finding P0/P1: sem baseline numérico que ultrapasse o limiar de forma atribuível ao delta; o delta em si é bem coeso (serviço novo pequeno, camadas respeitadas, mascaramento encapsulado).
