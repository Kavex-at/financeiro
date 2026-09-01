# Tasks — copiar linha digitável do boleto no item do lote

> **Slug:** `copiar-barcode-item-lote` · **Branch:** `feat/copiar-barcode-item-lote` · **Base:** `main` (d70088e)
> **Tipo:** feature-tweak (frontend + backend) · **Risco:** baixo — só leitura, nenhum write novo no ERP

## Contexto

A analista precisa da linha digitável do boleto para conferir com o banco. Hoje o dado existe
no ERP (`FinItemSispag.itsNumCodbar`) mas **não sai de lá**: aparece só em probe jobs, nunca no
domínio nem na API.

**Por que no item do lote e não na tabela de títulos.** O código de barras é anexado pelo ERP no
`importarTitulos(associarDda)`, que roda **dentro** da geração da remessa
(`RemessaService.gerarRemessaSerializado`, linhas 431-513). Antes disso não existe item no
`fin015` e o barcode não existe em lugar consultável — o item do `fin124` não tem `docCod`
(0% medido, ADR-0040). Em lote `RASCUNHO` não há o que copiar.

**Formato.** `itsNumCodbar` tem **47 dígitos** (linha digitável), não os 44 do código de barras
(`sispag-boleto-dda-sondagem.md:95`). É o que se cola no app do banco. **Não converter para 44**
nesta fatia.

## Decisões de desenho

1. **Leitura sob demanda, não persistência.** Nada de migration nem de tocar
   `gerarRemessaSerializado` — é o caminho de escrita não-idempotente mais crítico do repo
   (ADR-0013). Uma coluna nova ali paga risco alto por conveniência de UI.
2. **Fetch lazy ao expandir o card**, espelhando o que o `LoteCard` já faz com
   `modalidades-disponiveis` (`LoteCard.tsx:134-149`). Buscar na expansão, e não no clique,
   mantém o `writeText` **síncrono** — navegador bloqueia clipboard depois de `await`.
3. **Zod que valida, não coage.** Lição da emenda #2 do ADR-0040: `Number(x ?? 0)` transformaria
   um rename do Conexos em "nenhum item tem boleto". Aqui: 47 dígitos ou o item é omitido.
4. **Nunca logar a linha digitável inteira.** Mesma disciplina do `RemessaCnabValidator`, que
   mascara barras — o número identifica beneficiário e valor.

---

### Task 1: Cliente lê `itsNumCodbar` dos itens do lote

Novo método `listarLinhasDigitaveisDoLote({ filCod, bncCod, flpCod })` sobre o endpoint já usado
por `listarChavesDoLote` (`fin015/finItemSispag/list/{fil}/{bnc}/{flp}`), devolvendo
`Array<{ docCod, titCod, linhaDigitavel }>` só para itens com `itsNumCodbar` válido.

**Files to change:**
- `src/backend/domain/client/ConexosSispagWriteClient.ts`
- `src/backend/domain/client/ConexosSispagWriteClient.test.ts`

**Acceptance criteria:**
- Leitura via `runWithRetry`; nunca chama `postGenericOnce`.
- Schema Zod dedicado: `itsNumCodbar` = string de exatamente 47 dígitos. Item que não bate é
  **omitido**, nunca vira string vazia.
- Grid ilegível → `ConexosError` explícito, não lista vazia (lista vazia é uma afirmação que a
  leitura falha não pode fazer).
- Testes: item com barras devolvido; `null` omitido; 47 dígitos com letra omitido; string curta
  omitida; grid vazio → `[]`; falha → `ConexosError`.

**Dependencies:** nenhuma

### Task 2: Serviço expõe por lote, vazio em rascunho

`SispagPainelService.linhasDigitaveisDoLote(loteId)` → `Array<{ docCod, titCod, linhaDigitavel }>`.

**Files to change:**
- `src/backend/domain/service/sispag/SispagPainelService.ts`
- `src/backend/domain/service/sispag/SispagPainelService.test.ts`

**Acceptance criteria:**
- Lote `RASCUNHO` (sem `flpCod` nativo) → `[]` **sem chamar o ERP**.
- Lote sem `flpCod` no ledger → `[]` + `BUSINESS_WARN`, nunca exceção.
- Falha do ERP → `[]` + `BUSINESS_WARN` (o card não pode quebrar por um botão de copiar).
- Nenhum log contém a linha digitável completa.
- Testes cobrindo os três caminhos.

**Dependencies:** Task 1

### Task 3: Rota `GET /lotes/:id/linhas-digitaveis`

Espelha `/lotes/:id/modalidades-disponiveis` (`routes/sispag.ts:57-65`).

**Files to change:**
- `src/backend/routes/sispag.ts`
- `src/backend/routes/sispag.test.ts`

**Acceptance criteria:**
- Responde `{ itens: [...] }`, mesmo formato e mesmo `asyncHandler` das rotas vizinhas.
- Lote inexistente → 404 via `respondLoteError`.
- Teste de rota cobrindo sucesso e 404.

**Dependencies:** Task 2

### Task 4: Botão de copiar no LoteCard + tooltip honesto na tabela de títulos

**Files to change:**
- `src/frontend/lib/sispag.ts`
- `src/frontend/app/sispag/components/LoteCard.tsx`
- `src/frontend/app/sispag/page.tsx`

**Acceptance criteria:**
- `fetchLinhasDigitaveis(loteId)` no padrão de `fetchModalidadesDisponiveis`.
- `LoteCard`: fetch em `useEffect` ao expandir, com gate `!isRascunho`; cleanup com `vivo`.
- Item com `modalidade === 'BOLETO'` e linha disponível: botão `variant="ghost" size="icon"`,
  ícone `Copy`, `aria-label` e `title`, reusando o padrão de `recebimentos/page.tsx:326-334`
  (`navigator.clipboard.writeText` + `toast.success` / `toast.error`).
- Item BOLETO **sem** linha digitável → nenhum botão (não renderizar desabilitado sem motivo).
- Tooltip da tag em `page.tsx:726` passa a explicar que o código de barras é anexado pelo
  Conexos na geração da remessa. A tag segue informativa, sem clique.
- O `toast` confirma sem despejar os 47 dígitos no corpo.
- `DesignSystemReviewer` aprovado.

**Dependencies:** Task 3

---

## Gates

- `npm run typecheck` · `npm run lint` · `npm test` (backend e frontend)
- **DesignSystemReviewer** — `src/frontend/` foi tocado
- **Regis-Review** com escopo nos diretórios do delta; só P0 re-entra no loop
- Rebase de `main` antes do PR
- Bump de versão (há `feat` no delta) — **`scripts/bump-version.ps1` é PowerShell e não roda
  nesta máquina**; fazer à mão (FE+BE em lockstep) + `CHANGELOG.md`

## Ground-Truth

Não há lógica monetária nova — é passagem de um campo do ERP para a tela, sem cálculo. O
`GroundTruthValidator` não se aplica.

Verificação equivalente disponível de graça: num lote com remessa gerada, a linha digitável (47)
e o código de barras do segmento J (44) do `.REM` descrevem o mesmo boleto. Se sobrar tempo, vale
conferir consistência usando os fixtures `__fixtures__/*.rem` — **fora do escopo mínimo**.

## Fora de escopo (registrado para não virar surpresa)

- Converter 47 → 44 dígitos.
- Copiar na tabela de títulos a pagar (o dado não existe naquele estágio).
- Antecipar `criarLote`/`importarTitulos` para o rascunho (criaria lote órfão no ERP a cada
  rascunho abandonado — ver conversa de 2026-09-01).
- **Bug separado, não deste tweak:** `prontoParaRemessa` é sempre `true`
  (`ConexosSispagClient.ts:158`) porque `numOpt` coage `null` → `0` em `itsVldModalidade`. Com
  `temBoleto` e `temContaBanco` fixos em `false`, esse é hoje o único termo da expressão. O aviso
  de `page.tsx:753` nunca dispara.
