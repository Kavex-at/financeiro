---
id: 0036
title: A homologação da NDe é medida pelo estado gravado no documento, não pela resposta do POST
status: accepted
date: 2026-08-11
supersedes: []
amends: [0024]
related_files:
  - src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts
  - src/backend/domain/client/ConexosNdeFiscalClient.ts
  - src/backend/domain/client/ConexosNdeClient.ts
  - src/backend/domain/errors/HomologacaoRejeitadaError.ts
  - src/backend/domain/interface/recebimentos/constants.ts
  - ontology/integrations/conexos-com297-homologacao.md
---

# ADR-0036 — A homologação da NDe é medida pelo ESTADO GRAVADO

## Contexto

Em 11/08/2026 o analista processou o recebimento da **DYNAMIS** (`pesCod 699`, processo **3639**,
R$ 174.036,61). A tela não mostrou erro algum: o `POST /recebimentos/.../solicitacao-numerario`
respondeu **200**, a execução foi marcada `settled` e a transação virou `processada`. Só depois ele
percebeu que a Nota de Débito **não estava homologada** — e, ao tentar homologar à mão, não conseguiu
mais.

### O que a sonda de produção mediu (read-only, 2026-08-11)

A NDe **18771** estava, e continua, **aberta**:

| Campo | 18771 (DYNAMIS) |
|---|---|
| `vldStatus` | `1` (aberto) |
| `docVldNfehom` | `0` (não homologado) |
| `docEspNumero` | `"0"` |
| `right` | `RW` (documentos homologados viram `RO`) |

Isso apesar de `POST com297/homologaNfe/18771` ter devolvido **HTTP 200**, com
`docVldComvalidacoes: 0` — valor que o `ConexosNdeClient` classifica como "homologada com validações
não bloqueantes" (decisão de 2026-08-03).

O controle desmonta a explicação fácil. A NDe **18779** (GOPER), do mesmo dia e do mesmo fluxo,
carregava **exatamente as mesmas três validações de aviso** (condição de pagamento, tipo de frete,
GTIN do produto) e **homologou** (`docVldNfehom: 1`). Ou seja: os avisos não separam os dois casos, e
nenhum valor de `docVldComvalidacoes` separa. **A resposta do POST não é veredito.**

### O achado maior

Varrendo a população da `gcd 248` na filial 2, a divisão é limpa:

| | `vldStatus` | `vldAutorizado` | `docEspNumero` | `vldNfeGerado` |
|---|---|---|---|---|
| 18737, 18736, 18735, 18734, 18608, 18441 — feitas à mão | `3` | `1` | `180739`, `180738`… | `1` |
| 18779, 18778, 18348 — homologadas pela automação | `2` | `0` | `"0"` | `0` |
| 18771 | `1` | `0` | `"0"` | `0` |

**Nenhuma NDe produzida pela automação virou NF-e.** A 18348 está parada em `vldStatus 2` desde
03/08 — oito dias. Não é o SEFAZ demorando: `vldNfeGerado: 0` diz que a NF-e nunca foi gerada.
Homologar **não** transmite. Entre `2` e `3` existe um passo que a automação não faz.

Enquanto isso, o `etapaPoll` lia `vldAutorizado: 0` e registrava *"SEFAZ ainda não autorizou
(assíncrono) — reconcilia depois"*, que descreve uma espera que nunca termina.

### Por que o conserto manual também falhou

A tentativa de homologação carimba `fisTimEmissao`/`fisTimSaida` na NF-e — na 18771, **15:36:19**. A
partir daí correm **15 minutos** de tolerância. O analista tentou às **15:52:45**, 16min26s depois, e
o com194 respondeu com duas linhas `fdvVldErr: 1` (❌):

```
A DATA DE MOVIMENTO DA NOTA FISCAL EXCEDEU A TOLERÂNCIA DE 15 MINUTOS
A DATA DE EMISSÃO  DA NOTA FISCAL EXCEDEU A TOLERÂNCIA DE 15 MINUTOS
```

A janela fechou **antes** de alguém poder perceber o problema, justamente porque a execução foi
reportada como sucesso. O silêncio não foi só ruim de auditoria: consumiu o prazo de recuperação.

### Dois erros de leitura do com194

- **Severidade invertida.** `fdvVldErr` é `1` = ERRO (❌) e `2` = AVISO (⚠️) — medido casando as
  linhas do modal "VALIDAÇÃO - COM_194" com a resposta da API. A constante dizia
  `VALIDACAO_BLOQUEANTE = 2` e o comentário, "1 = aviso". O único consumidor casa a linha de condição
  de pagamento, que é `2`: acertava o valor e errava a explicação.
- **Classe escondida.** `fdvVldTperr` é filtro **obrigatório** (sem ele: `Generic.REQUIRED_FILTER_ERROR`,
  HTTP 400) e não aceita lista. Consultávamos só a classe `1`; o doc 18737 guarda a sua única validação
  na `2`.

## Decisão

1. **O veredito da homologação é `docVldNfehom`, lido de volta do documento.** A leitura pós-homologação
   já existia — servia só para conferir `docMnyValor`. A resposta estava em mãos e era descartada. Se o
   documento não ficou `docVldNfehom: 1`, a etapa **falha**: nada de `setEtapa('homologado')`, nada de
   `markSettled`, nada de NDe gravada como `emitida`.
2. **A mensagem de falha carrega as validações do com194 e o prazo.** O analista precisa saber o que
   travar e que tem ~15 minutos antes de a tolerância da NF-e fechar a porta — depois disso só com as
   datas liberadas no ERP (`vldDtEmisLiberada`/`vldDtMovLiberada`) ou cancelando e reemitindo.
3. **`docVldComvalidacoes` fica ADVISORY.** O branch do client segue permissivo — ele não tem como
   saber, e endurecê-lo quebraria os casos que homologam com aviso. Quem decide é o serviço, pelo estado.
4. **O com194 é lido nas duas classes de `fdvVldTperr`**, unindo os resultados; uma classe indisponível
   devolve o que deu, todas indisponíveis lançam (silêncio não pode virar "sem pendência").
5. **`vldStatus: 2` é nomeado como o que é** no log do poll: homologada e **sem NF-e**, um estado que
   não se resolve sozinho — não "o SEFAZ ainda vai responder".
6. **A transmissão da NF-e vira open-gap explícito** (`com297-transmissao-nfe`), não uma suposição de
   assincronia.

## Consequências

- Uma homologação que não pega passa a derrubar a alocação com `status: error` na etapa `obs-done`. A
  baixa e a nota continuam no ERP — como já continuavam; a diferença é que agora **alguém fica sabendo**,
  a tempo.
- `listValidacoes` custa duas requisições por chamada. É leitura, e o preço é aceitável para não
  esconder metade das validações.
- Os dublês de teste passam a modelar `docVldNfehom`/`vldStatus`. Um fake que não os devolve é recusado
  — que é exatamente o comportamento desejado.
- **Não resolvido nesta ADR:** a NDe continua sem virar NF-e. A verificação impede o falso sucesso da
  homologação; a transmissão segue manual até o passo ser contratado por HAR.

## Alternativas rejeitadas

- **Tratar `docVldComvalidacoes: 0` como recusa.** Foi a primeira hipótese e o controle a derrubou: a
  18779 homologou com o mesmo quadro de avisos. Endurecer o enum quebraria casos que funcionam e
  continuaria confiando na resposta em vez do estado.
- **Bloquear a homologação quando houver qualquer validação no com194.** Reprovaria a 18779 e as seis
  NDes autorizadas — os avisos de condição de pagamento, frete e GTIN não impedem homologar.
- **Fazer o poll esperar o SEFAZ.** Já foi tentado (loop de 5 min segurando o request) e foi revertido
  por bom motivo. Além disso, não há o que esperar: sem `vldNfeGerado: 1` nada foi transmitido.
- **Corrigir as três validações antes de homologar** (condição de pagamento, frete `SEM TRANSPORTE`,
  GTIN do produto). Pode ser o que destrava a transmissão, mas é **hipótese não medida** — a 18779
  homologou com as três em pé. Vira experimento, não decisão.
