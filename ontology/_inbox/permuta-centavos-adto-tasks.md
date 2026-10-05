# Tasks — permuta-centavos-adto (I-Write-10, ADR-0062)

**Modo:** `/feature-tweak business-rules/fin010-write-contract "fix: líquido da baixa excede o disponível do adto por centavos"`
**Branch:** `fix/permuta-centavos-adto`. `entity_changed = false` (regra nova no contrato, sem entidade nova).

## Entrevista (tweak, resumida)

- **Comportamento atual:** a âncora I-Write-6 só ajusta o líquido no full-consume de título único.
  Na última perna N:M e em invoice multi-título, os arredondamentos por título/perna podem somar
  0,01 acima do `bxaMnyValorPermuta`, e o ERP recusa (no gravar ou no Finalizar).
- **Comportamento desejado:** nenhuma baixa envia líquido acima do disponível vivo do adto quando o
  excesso é de centavos (≤ R$1,00). O excesso sai da conta de variação já em uso.
- **Regra ou bug de implementação?** Regra: a ADR-0020 excluiu esses casos de propósito, com uma
  premissa que se mostrou falsa. Por isso entram ADR-0062 e o invariante I-Write-10.
- **Invariantes afetados:** I-Write-6 (inalterado, roda antes), I-Write-1 (inalterado,
  `bxaMnyValor` não muda), I-Write-8b (o resíduo em USD é medido pelo `bxaMnyValor`, que não muda).
- **Casos canônicos:** borderô 23184 (multi-título, juros) e borderô 23188 (perna N:M, desconto).
  Números reais em `ReconciliacaoPermutaService.test.ts`.

## T1 — Teto do líquido em `baixarTitulo`

Arquivos: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts` (+ teste).

- [x] AC1: título 2 de invoice multi-título com excesso de 0,01 → `bxaMnyJuros` 419,08 → 419,07 e
      `bxaMnyLiquido` = `bxaMnyValorPermuta` (28.499,32); título 1 inalterado (314,31).
- [x] AC2: perna N:M (sem âncora) com DESCONTO e excesso de 0,01 → `bxaMnyDesconto` 472,06 → 472,07,
      líquido 35.484,31.
- [x] AC3: excesso > R$1,00 → nada é ajustado, sai BUSINESS_WARN.
- [x] AC4: juros menor que o excesso → nada é ajustado (juros nunca negativo), sai BUSINESS_WARN.
- [x] AC5: líquido abaixo do disponível (perna parcial) → inalterado (testes existentes passam sem
      mudar asserções).
- [x] AC6: o passo 4 (`atualizarValorLiquido`) recebe a variação já limitada; o `markSettled`
      agrega o juros limitado.
- [x] AC7: os testes existentes da âncora I-Write-6 passam sem mudar asserções.

## Plano de Validação Ground-Truth

- **Fonte:** `permuta_alocacao_execucao.request_payload` em produção (o que foi efetivamente enviado
  ao `fin010`, com o `bxaMnyValorPermuta` devolvido pelo ERP no passo 3).
- **Amostra:** todas as execuções reais com `bxaMnyValorPermuta` no payload (196 em 2026-10-05).
- **Critério:** reaplicar `limitarAoDisponivelDoAdto` ao payload gravado. Nenhuma linha pode ficar
  com líquido acima do disponível dentro do teto, e as linhas sem excesso devem sair byte-idênticas.
  As três com excesso de 0,01 (16596, 23184, 23188) devem passar a fechar no disponível; a 2646
  (excesso R$921 mil) deve permanecer intocada.
- **Read-only:** nenhuma escrita no ERP nem no banco.
