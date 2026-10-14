# Regis-Review reduzido 2026-10-14-1330 — follow-ups de `sispag-sugestao-boleto-dda`

> Origem: `docs/regis-review/2026-10-14-1330/` (REPORT.md + 4 relatórios: security, fault-tolerance,
> testability, performance). **P0 = 0.** Regra 11: só P0 volta ao loop; o resto fica aqui. Cada item
> cita o card do relatório de origem.

## P1 (decidir antes do merge — ver REPORT.md)

| Card | Tema | Resultado esperado |
|---|---|---|
| fault-tolerance-1 (M) | Saída para a decisão `CONFIRMADA`: anular por título e anular em cascata ao revogar o par (Q-E); sinalizar confirmações órfãs (boleto saiu do pool, vinculado pelo ERP, título pago) | transições saindo de CONFIRMADA: 0 → ≥ 1; boleto preso por decisão órfã: possível → impossível |
| performance-1 (M) | Cache do cenário com single-flight (TTL curto) e invalidação por decisão e por sincronização DDA; uma chamada devolve tudo em vez de paginar 100 em 100 | execuções do motor por carga da página: 3–11 → ≤ 1 |
| testability-1 (S) | Teste de integração em Postgres real para `TituloAPagarRepository.buscarPorChave` e `BoletoDdaRepository.buscarPorChave` | integração: 0/2 → 2/2 |

## P2

| Card | Tema |
|---|---|
| security-1 | `GET /boletos-dda` devolve a linha digitável a `ver` sem limiter nem evento de auditoria (estado conhecido e aceito, ADR-0053): limiter + evento agregado de leitura |
| security-2 | `motivo` / `motivo_revogacao` livres podem receber uma linha colada numa tabela append-only: rejeitar 44/47 dígitos no Zod e com CHECK |
| security-3 | `copiarLinha` aceita qualquer par título × boleto ativo, não só o que o motor sugere; nenhuma rota usa `req.user.filiais` |
| security-4 | Confirmar ATENCAO cria par VIGENTE que promove boletos futuros a CONHECIDO dentro dos limites; a chave genérica (≠ 341/237) é só prefixo de 8 dígitos e pode colidir entre emissores (latente para o passo 3) |
| fault-tolerance-2 (S) | Corrida confirmar × revogar: `buscarParVigente` na transação sem lock; reconferir/travar dentro da transação |
| fault-tolerance-3 (S) | Carga de sugestões falha em silêncio na página (`catch { setSugestoes(null) }`): mostrar aviso com nova tentativa; teto de 20 páginas é silencioso |
| fault-tolerance-4 (S) | Frescor por arquivo (hoje `max(sincronizado_em)` global) e recusar confirmar com pool defasado |
| fault-tolerance-5 (M) | **Guarda de `codbar` repetido na remessa** (pré-requisito do passo 2) e sinalizar o boleto informativo duplicado. O gate encontrou 27 títulos flagados pelo ERP em grupos com mais títulos que boletos (PEDRONI: 10 títulos, 2 boletos) |
| testability-2 | Ramos de erro do repositório e do serviço (funções 68% / branches 76%) |
| testability-3 | O gate ground-truth é script manual, sem exit asserido em CI, não exercita centavos, 1–5 dias, ATENCAO e VENCIDO_INFORMATIVO; persistir baseline |
| performance-2 (S) | `listBoletos({})` sem janela de 60 dias nem LIMIT |
| performance-3 (S) | Decisões `REJEITADA` nunca envelhecem e o endpoint quebra em 10 000 linhas |
| performance-4 (S) | Uma requisição + patch local após decidir (hoje até ~12 requisições por decisão) |
| performance-5 (S) | Proteger contra agrupamento de valores repetidos (4,4 s sintético com 25 valores distintos) e logar a duração |

## P3

- fault-tolerance-6: coletor determinístico em `comparaDoc`; `listarEventos` falhar alto (hoje trunca em
  1000); rejeitar × confirmar concorrentes deixam duas linhas para o mesmo par.
- testability: 3 `randomUUID()` diretos em `SugestaoBoletoRepository` (linhas 201, 256, 403).
- security: `emissor_chave` completa (banco:agência:conta) em claro em 3 tabelas, uma imutável; a API
  mascara na saída.

## Herdados do design-system review (não corrigidos no loop)

- Skeleton nos carregamentos; reuso do `FormDialog`; `Button variant="link"` no badge;
  `SITUACAO_BADGE[...].title` ainda só com `title` (compartilhado com a aba DDA);
  `linhaDigitavel` ainda na listagem `/boletos-dda` do front (estado conhecido).
