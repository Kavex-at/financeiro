# NDe — Spec das 3 etapas fiscais (HAR real, doc 18337, filial 2, produção, 2026-08-01)

Fonte: HAR de tráfego real. Fecha o GAP `nota-debito-fiscal` do writer permutas.
**Ordem obrigatória: (a) fiscal → (b) observações → (c) homologar.** Observações são
geradas a partir do tipo de nota de débito; homologar antes gera doc sem a observação SINIEF.

Headers: `Cnx-filCod` (2=Itajaí/SC), `Cnx-usnCod`, `Cnx-dataLanguage: pt`, Cookie sid/hdssid.
`filCod` NUNCA na URL — sempre no header. Path ids: docTip, docCod, fisCod.

## (a) Fiscal — com300  (read-modify-write OBRIGATÓRIO)
- `GET /api/com300/{docTip}/{docCod}/{fisCod}` → objeto `finDocFiscal` INTEIRO (73 campos).
- `PUT /api/com300` (sem id na URL) com o objeto inteiro; setar `fisVldTipoNfDebito = 6`
  (PAGAMENTO ANTECIPADO, **inteiro**). Campo omitido vira `null` no banco → nunca montar parcial.
- `filCod` no corpo E no header, consistentes. NÃO tocar `fisVldTipoNfCredito`.
- **Sucesso ⟺ HTTP 200 && resp.fisVldTipoNfDebito === 6** (resposta é o eco do objeto, NÃO envelope `messages[]`).

## (b) Observações — com131
- `POST /api/com131/geraObs` body `{"docTip":1,"docCod":18337}` (2 campos; filCod header; fisCod resolvido pelo servidor).
- `GET /api/com131/{docTip}/{docCod}` para ler.
- **Sucesso ⟺ HTTP 200 && resp.fisEspObs não-vazio.** Texto gerado pelo servidor (automação não compõe).
- **Idempotência (guard obrigatório):** `fisEspObs` termina em ` /` (parece separador → repetir pode APENDAR).
  1) GET primeiro; 2) se `fisEspObs` já contém `AJUSTE SINIEF` → NÃO chamar geraObs, seguir p/ (c);
  3) só chamar geraObs se vazio. (Torna retomável.)

## (c) Homologar — com297
- `POST /api/com297/homologaNfe/{docCod}` body `{}` (normal) OU `.../homologaNfeContingencia/{docCod}`.
- Rota: `contingencia = ["11","12"].includes(String(finDoc.vldTpNf))`. `vldTpNf` é string; doc="10"→normal.
  Valor desconhecido (≠10/11/12) → **abortar+alertar** (NÃO fail-open p/ normal).
- **Sucesso ⟺ resp.docVldComvalidacoes === 1.** HTTP 200 não significa nada.
  - `1` = sucesso limpo → prosseguir
  - `2` = homologado COM validações pendentes → registrar, buscar erros via com194, sinalizar revisão humana
  - outro = falha → alertar
- Quando `2`: `GET /api/com194/initialValues/{docTip}/{docCod}` + `POST /api/com194/documento/list`
  (filter docTip/docCod/`fdvVldTperr:1`). Logar `fdvEspErr`/`fdvEspObs`/`fdvVldErr`/`fdvCodSeq`.
- **Polling pós-homologar:** `vldAutorizado` CONTINUA `0` após homologar (SEFAZ é assíncrono).
  `docVldNfehom:1` ≠ autorizado. Fazer polling `GET /api/com297/{docCod}` até `vldAutorizado` mudar, com timeout+alerta.
- Transições esperadas: docVldNfehom 0→1, vldStatus 1→2, docEspNumero null→"0", vldDtMov/Emis 0→1; vldAutorizado 0→0.
- **Pré-condições (ng-disabled):** `!isNew && !isEditing && validaConferencia()` → checar `docVldConferencia`/`vldEnviarConferencia` no GET antes de disparar.

## Datas
Epoch **ms**, data de calendário à **meia-noite UTC**, servidor não converte fuso.
`ms = int(datetime(y,m,d, tzinfo=utc).timestamp()*1000)`. Converter BRT→UTC erra 1 dia.

## Quatro discriminadores distintos (NÃO reusar um helper)
| Etapa | Rota | Sucesso |
|---|---|---|
| geração | POST /api/com297/gerDocProcesso | `messages[0].valid==="SUCESSO"`, docCod em vars.docCod (string) |
| (a) fiscal | PUT /api/com300 | `resp.fisVldTipoNfDebito===6` |
| (b) obs | POST /api/com131/geraObs | `resp.fisEspObs` preenchido |
| (c) homologar | POST /api/com297/homologaNfe/{docCod} | `resp.docVldComvalidacoes===1` |

## ACL da conta de serviço (checar `GET /api/permissoes/new/com297`)
com300 UPDATE · com131 GERAR OBS (aco 1) · com297 HOMOLOGAR (aco 3) · com297 HOMOLOGAR CONTINGENCIA (aco 5)
· com194 SELECT · com297 FINALIZAR (aco 1) · com297 ESTORNAR (aco 2). Usar creds da conta de serviço, não humano.

## Checklist de aceite v2
- (a) GET antes do PUT; valida fisVldTipoNfDebito===6
- (b) checa fisEspObs antes de geraObs
- (c) rota por vldTpNf abortando em desconhecido; trata docVldComvalidacoes (2 ≠ sucesso); coleta com194
- polling vldAutorizado com timeout; datas epoch ms sem fuso; Cnx-filCod/usnCod da conta serviço; falha em 401/403

## PENDÊNCIAS (gates antes de PRODUÇÃO — flag do próprio spec)
1. **[ALTO] docMnyValor zerado 100→0 após homologar** (mnyBruto 100→0, item ainda 100). NDe com valor 0 = problema FISCAL. **Confirmar com o fiscal antes de rodar em produção.**
2. `docDtaEmissao`/`docDtaMovimento` reescritas p/ data corrente pelo servidor na homologação.
3. `geraObs` é idempotente? (não testado)
4. Endpoint de autenticação (sessão programática) — job trava ao expirar cookie.
5. **Divergência prdCod: item gravado `2`, com194 reclama de `41978`** → produto errado na nota.
6. Consulta de período contábil aberto (docs inexcluíveis).
7. Latência SEFAZ até `vldAutorizado` — dimensionar timeout.
