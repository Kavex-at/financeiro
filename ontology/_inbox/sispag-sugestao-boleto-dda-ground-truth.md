# Ground-truth — sugestão de boleto DDA (`sispag-sugestao-boleto-dda`, passo 1)

> Script: `src/backend/jobs/validate-sispag-sugestao-boleto-dda-v1.ts` (read-only; roda o
> `MotorSugestaoBoleto` de produção sobre o banco; **não** instancia client do Conexos).
> Executado em PRD (somente leitura) em 2026-10-14, pool até o arquivo mais recente do dia.

## O que é e o que não é ground truth

- **Títulos que o ERP recusou** (a população que a feature quer tratar): `SEM_GROUND_TRUTH`. O ERP
  não diz se o boleto sugerido é o certo; só a confirmação humana vai produzir essa verdade.
- **Títulos que o ERP já associou**: ground truth parcial. O boleto do ERP é o de mesmo valor e
  mesmo dia. O gate vira esses títulos para "não flagados", libera seus boletos e deixa **todos**
  disputarem o pool ao mesmo tempo; pergunta se o motor aponta o mesmo boleto.

## Resultado (176 títulos BOLETO flagados pelo ERP)

| Veredito | Títulos | Leitura |
|---|---|---|
| REPRODUZ | 98 | o motor aponta um boleto de mesmo valor e dia (o do ERP) |
| EMPATE_LEGITIMO | 44 | 2+ boletos idênticos; o motor se recusa a chutar |
| ERP_COMPARTILHA_BOLETO | 26 | o ERP flagou N títulos para M < N boletos (ver abaixo) |
| SEM_SUGESTAO | 8 | o motor deixou passar um caso que o ERP resolve (conservador) |
| **DIVERGE_OUTRO_BOLETO** | **0** | **critério: = 0 → APROVADO** |

Amostra cega (credores fora dos casos de desenvolvimento): 31 credores, 80 títulos, 56 reproduzem,
**0 divergem**.

## Achado sobre o ERP (fora do escopo do passo 1, mas importante)

**27 títulos flagados estão em grupos com mais títulos do que boletos** (ex.: PEDRONI, 10 títulos de
R$ 1.412,00 vencendo em 14/10 para 2 boletos). O flag do ERP é "existe boleto de mesmo valor e dia",
não uma reserva 1:1. No leave-one-out o motor entrega o boleto a UM título e não o repete nos outros,
que é o comportamento correto; o ERP, ao contrário, marca todos como "com DDA". Sem um guarda de
código de barras repetido no lote (`RemessaService`), há risco de pagamento em duplicidade ou de
remessa com a mesma barra duas vezes. **Recomendação:** tweak próprio, antes do passo 2, com a
guarda "mesmo `codbar` duas vezes no lote → bloqueia".

## Cobertura descritiva (sem ground truth)

Dos 953 títulos BOLETO não flagados, o motor produz: **FORTE 248**, **VENCIDO_INFORMATIVO 40**,
**ATENCAO 4** (os demais ficam sem sugestão: sem boleto de mesmo valor/dia, ou empate).
Maiores credores com sugestão: MULTILOG BRASIL 80, MULTILOG S/A 67, TRANSMAGNA 17, AR SOLUÇÕES 17,
NELSON HEUSI 16, CEVA 15, MULTILOG COMÉRCIO 14, SANTOS BRASIL 12.

## Limites

- A "verdade" do ERP é inferida (valor+dia), não o vínculo gravado (os vínculos explícitos do pool
  apontam para títulos já pagos). Por isso o veredito é de sanidade, não de precisão.
- Não há amostra de banco emissor fora de 341/237 neste gate (`SEM_AMOSTRA_GENERICO`): o gate não
  exercita a chave genérica.
- Os 8 `SEM_SUGESTAO` merecem leitura caso a caso (são perdas de cobertura, não erros).
