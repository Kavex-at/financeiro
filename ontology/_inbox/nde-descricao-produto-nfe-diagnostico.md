# Diagnóstico — "1ª Descrição dos Produtos" do cliente trava a homologação da NDe

**Aberto em:** 2026-08-11 · **Origem:** homologação falhando em campo (relato do Yuri) · **Prioridade:** P0
**Status:** causa-raiz mapeada no contrato do ERP; **falta confirmar com uma leitura no tenant** (sonda pronta).

## Sintoma

Clientes cujo cadastro tem **1ª Descrição do produto na NF-e = "Descrição da DI + DUIMP"** não conseguem
homologar a NDe. Mudando o campo, no cadastro do cliente, para **"Descrição do Produto"**, a homologação
passa (verificado manualmente).

Mudar o campo no cadastro **não é solução**: ele governa a descrição de item de **todas** as NF-e de saída
daquele cliente — inclusive as de **mercadoria**, onde descrever a DI/DUIMP é exatamente o que o fiscal
quer. Trocar para "Descrição do Produto" para destravar a NDe quebra o faturamento da mercadoria. Além
disso o cadastro é **versionado** (`cmn025`, `dpeCodSeq` = "Cód. Alteração"): cada troca cria uma versão
nova, com rastro, e vale para todo mundo que emitir nota naquele intervalo.

## Onde o campo vive (contrato confirmado no swagger do tenant)

| Peça | Identificador | Observação |
|---|---|---|
| Campo do cadastro | `CmnDadosPessoas.dpeVld1DescrNfe` (e `dpeVld2DescrNfe`) | tela **`cmn025` — Cadastro de Pessoas** |
| Enum | `0` Padrão · `1` Descrição Produto · `2` Complemento · `3` Descrição Detalhada · **`4` Descrição DI** · `5` Série · `6` Descrição Invoice | o rótulo "DI + DUIMP" do tenant = `4` |
| Campo do ITEM da nota | `ComDocProdutosFisFin_ComDocProdutosFis.dprLngDescrNf` — *"Descrição para Impressão"*, `maxLength 4000` | é **esta string** que vira o `xProd` da NF-e |
| Quem calcula | `GET /api/com297/comDocProdutos/preDescrProdutoNf/{docCod}/{fisCod}/{prdCod}/{dprCodSeq}` | rota que o UI usa para **pré-preencher** a descrição do item aplicando a regra do cadastro |
| Escrita do item | `PUT /api/com297/comDocProdutos` (objeto INTEIRO, read-modify-write, igual ao `com300`) | + `GET .../{docCod}/{fisCod}/{prdCod}/{dprCodSeq}` para ler o item inteiro |
| Registro vigente | `vldValido = 1` | filtro do `cmn025/list` |

Referências no repo: `docs/conexos-api/020-cmn0.json` (schema `CmnDadosPessoas`),
`docs/conexos-api/060-com2.json` (paths `com297/comDocProdutos/*`, schema `ComDocProdutosFisFin*`).

## Causa-raiz (hipótese forte, mecanismo inteiro fechado)

A NDe é gerada com o produto **41978 / "PAGAMENTO ANTECIPADO"** no *header* do `com297/gerDocProcesso`
(`NDE_GERACAO_DEFAULTS`, `SnPayloadBuilder.buildNotaDebitoRealPayload`) — a nossa automação **nunca**
escreve a linha de item da NDe: quem materializa o item é o próprio ERP, a partir do header
(`RecebimentoNumerarioService.etapaNotaDebito`, comentário "NÃO adicionar produto via
com297/comDocProdutos").

Ao materializar o item, o ERP resolve a `dprLngDescrNf` pela regra do cadastro do cliente:

- `dpeVld1DescrNfe = 1` (Descrição Produto) → descrição = "PAGAMENTO ANTECIPADO" → NF-e válida → homologa.
- `dpeVld1DescrNfe = 4` (Descrição DI/DUIMP) → o ERP tenta derivar a descrição das **adições da DI**. O
  produto 41978 é um encargo, **não tem adição de DI** → a descrição sai **vazia** (ou inválida) → NF-e sem
  `xProd` → a homologação é recusada.

Isso é consistente com o que a leg fiscal já produz para esse produto: o `com194` do tenant já reclamou
`PRODUTO 41978 SEM GTIN CADASTRADO` (ver `RecebimentoNumerarioService.test.ts`) — é a mesma classe de
problema (produto de encargo passando pelas validações desenhadas para mercadoria).

**A automação hoje não toca em `dprLngDescrNf` em lugar nenhum** (grep: zero ocorrências em `src/`). Ou
seja, ela está inteiramente à mercê da configuração por-cliente — que é justamente o que não pode mudar.

### O que ainda falta confirmar (1 leitura, sem escrever nada)

Se a `dprLngDescrNf` sai **vazia** ou **preenchida com outra coisa** (ex.: a mercadoria inteira da DI,
estourando limite ou divergindo do produto). O tratamento é o mesmo, mas a mensagem de erro e o texto de
fallback mudam. Para isso existe a sonda:

```
src/backend/routes/recebimentos.e2e.descricaoNfeNde.integration.test.ts
```

Read-only por construção (allowlist de rotas envolvendo `getGeneric`/`postGeneric*`/`putGenericOnce`/
`deleteGeneric` — qualquer rota fora da lista morre na máquina). Ela lê: o doc `com297`, os itens e a
`dprLngDescrNf` gravada, o `preDescrProdutoNf` (o que o ERP calcularia agora), o `com194` (validações) e o
`cmn025` do cliente (`dpeVld1DescrNfe`/`dpeVld2DescrNfe`).

```bash
cd src/backend
CONEXOS_PROBE_BASE_URL=... CONEXOS_PROBE_USERNAME=... CONEXOS_PROBE_PASSWORD=... \
PROBE_FIL_COD=<filial> PROBE_ND_DOC_COD=<docCod da NDe que falhou> \
npx jest recebimentos.e2e.descricaoNfeNde --testPathIgnorePatterns "/node_modules/"
```

Rodar duas vezes — um caso que falhou e um que passou (cliente com a 1ª descrição = Descrição Produto) —
fecha o diagnóstico com evidência de ambos os lados.

## Solução proposta

**Escrever a descrição do item da NDe no próprio documento, nunca no cadastro do cliente.**

Nova etapa entre `etapaNotaDebito` (geração) e `etapaFiscal` (com300), no
`RecebimentoNumerarioService` — chamemos `etapaDescricaoItem`:

1. `POST com297/comDocProdutos/list/{ndDocCod}/{fisCod}` → localiza o item (prdCod/dprCodSeq).
2. Lê a `dprLngDescrNf` gravada. **Se já estiver preenchida, não faz nada** (o cliente com cadastro "bom"
   segue exatamente como hoje — a mudança é inerte para ele).
3. Se estiver vazia/branca: `GET com297/comDocProdutos/{docCod}/{fisCod}/{prdCod}/{dprCodSeq}` (item
   INTEIRO) → seta `dprLngDescrNf` com o texto de fallback → `PUT com297/comDocProdutos` (objeto inteiro,
   `putGenericOnce`, mesma doutrina RMW do `com300` — campo omitido vira `null`).
4. **Discriminador próprio** (a spec proíbe reusar helper de sucesso): relê o item e exige
   `dprLngDescrNf` não-vazia. Falhou → `NumerarioGapError` na etapa `descricao-item`, fail-closed **antes**
   de qualquer coisa irreversível (a homologação ainda não aconteceu).
5. Retomável/idempotente como as outras: `setEtapa(key, 'descricao-item-done')` no ledger, entre `nd` e
   `fiscal-done` na ordem monotônica de `etapaOrdem`.

### Texto de fallback — o default NÃO precisa de decisão de ninguém

O texto **não é o que estava falhando**. Com o cadastro em `1` (Descrição Produto) o próprio ERP escreve
`dprLngDescrNf = "PAGAMENTO ANTECIPADO"` (a descrição cadastrada do produto 41978) e a NF-e homologa — foi
o teste manual. Ou seja: essa string já está **provada** perante o com194 e o SEFAZ. O que faltava era
alguém escrever **alguma coisa** naquele campo quando o cadastro está em `4`.

Então o fallback default é: **copiar o `prdDesNome` da própria linha do item** (o `comDocProdutos/list` já
devolve esse campo — é a descrição cadastrada do produto, `maxLength 50`, cabendo folgado nos 4000 do
`dprLngDescrNf`). Isso reproduz **byte a byte** o resultado do workaround manual, por documento, e continua
certo se a Columbia renomear o produto no cadastro. Sem string hardcoded, sem env, sem pergunta pendente.

Ordem de resolução, então:
1. `dprLngDescrNf` já preenchida pelo ERP → **no-op** (cliente com cadastro "bom" não vê diferença);
2. senão, `preDescrProdutoNf` se devolver algo não-vazio (respeita a config do cliente quando ela funciona);
3. senão, `prdDesNome` da linha do item — o equivalente exato do "Descrição Produto".

**A pergunta ao fiscal só existe se eles quiserem MAIS do que isso** — por exemplo acrescentar a referência
do processo (`priEspRefcliente`) à descrição impressa. Aí sim é decisão deles, e vale um env
(`NDE_DESCRICAO_ITEM_FALLBACK`) para não exigir deploy. Note que o texto legal (AJUSTE SINIEF) **não** vive
aqui: ele vai nas observações do `com131`, que já rodam na etapa seguinte.

### Por que esta e não as outras

| Alternativa | Veredito |
|---|---|
| Trocar `dpeVld1DescrNfe` no cadastro do cliente (permanente) | **Não.** Quebra a descrição da NF-e de **mercadoria** daquele cliente, que é o caso legítimo do campo. |
| Trocar o campo, emitir, e restaurar (janela curta, via `PUT cmn025`) | **Não.** Escrita em dado-mestre versionado, com corrida contra qualquer NF-e emitida por humano na janela, rastro de alteração poluído e risco de deixar o cadastro errado se o processo morrer no meio. |
| Usar outro `prdCod` na NDe (um produto que tenha DI) | **Não.** A NDe é encargo, não mercadoria; e o 41978 é o produto acordado com o fiscal. |
| Outra Configuração de Documento (`gcd`) para a NDe | **Não resolve.** A regra da descrição vem da **pessoa** (`dpeVld*DescrNfe`), não do `gcd`. |
| Escrever `dprLngDescrNf` no item do documento gerado | **Sim** — é o único lugar por-documento, é exatamente o que o UI faz quando o analista edita o item, é reversível (o doc ainda não está homologado) e não afeta nenhuma outra nota. |

### Ganho colateral

Vale também gravar a leitura do cadastro no **pré-flight** (`classificarAlocacao`): se
`dpeVld1DescrNfe ∈ {3,4,5,6}` para o cliente do processo, o analista vê no preview que a NDe vai precisar do
fallback de descrição — em vez de descobrir no meio da execução. Barato (`cmn025/list` filtrado por `pesCod`
+ `vldValido:1`) e read-only.

## Passos, na ordem

1. Rodar a sonda no caso que falhou **e num que homologou** (cliente com a 1ª descrição = Descrição
   Produto) → confirma vazia × preenchida, captura a mensagem do `com194` e, sobretudo, prova que o valor
   **gravado** no item é o que vale (se o doc que homologou tem o texto persistido em `dprLngDescrNf`, o
   XML sai do campo armazenado, não de um recálculo na hora da homologação).
2. Só se a Columbia quiser um texto DIFERENTE do produto: fechar o texto com o fiscal. Caso contrário,
   nada a decidir (ver "Texto de fallback").
3. `/feature-tweak recebimento "descrição do item da NDe escrita no documento, não no cadastro do cliente"` —
   implementa a `etapaDescricaoItem` acima, com teste do caminho "já preenchida ⇒ no-op" e do caminho
   "vazia ⇒ PUT + relê + exige não-vazia".
4. Opcional, mesma fatia: sinal do pré-flight.

## Perguntas abertas

- A Columbia quer na descrição do item da NDe **algo além** de "PAGAMENTO ANTECIPADO" (o que o workaround
  manual já produz), tipo a referência do processo? Se não quiser, não há pergunta aberta aqui.
- A `dprLngDescrNf` está **vazia** ou **preenchida com a descrição da DI**? (a sonda responde)
- Existem NDes **já homologadas** com descrição vazia/errada por esse caminho? Se sim, é o mesmo tipo de
  passivo de `nde-indevidas-conta-e-ordem-diagnostico.md` — irreversível por código, conversa com o cliente.
