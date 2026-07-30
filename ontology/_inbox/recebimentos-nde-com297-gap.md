# Info-gaps — NDe fiscal (com297 homologação) · fatia `recebimentos-nde-com297`

> Fatia: `fix/recebimentos-nde-com297` (worktree, base PR #36). Contexto: ADR-0024,
> `integrations/conexos-com297-homologacao.md`, `business-rules/homologacao-nde-com297.md`.
> A **homologação** (passo terminal) está implementada, testada e **live-capable, gated OFF**. Estes
> gaps precisam fechar antes do **go-live** (ligar a escrita + trocar o `NDE_EMITTER_TOKEN`).

## P0 — bloqueiam o go-live

### G1 · `vldTpNf-distribuicao` — SEED da allowlist normal (gate-before-live)
`NDE_NORMAL_TP_NF_CONHECIDOS` está **VAZIO** de propósito (assertion, não assumption). Enquanto vazio,
o `ContingenciaDecider` **recusa** qualquer documento normal (só `{11,12}` contingência passam) — o
que é seguro (gated OFF) mas impede homologar a NF-e normal comum.
- **Pergunta:** qual a distribuição de valores distintos de `vldTpNf` nos documentos NDe da Columbia?
  (Puxar do DB ou do endpoint de listagem com297 que já lemos.) Se `11`/`12` nunca aparecem,
  contingência é empiricamente fora de escopo (encode como assertion). Se aparecem, medir o volume.
- **Ação ao responder:** popular `NDE_NORMAL_TP_NF_CONHECIDOS` com os códigos normais reais.

### G2 · `com297-doc-generation` — leg de GERAÇÃO que mint o `docCod`
A homologação precisa de um `docCod` de um documento com297 que **já exista**. O docx descreve a
geração só como **passos de UI** (sem endpoints):
- gerar-documento (Processo, Pessoa, Configuração, Emissão, Entrada, **Número = 0**, **Produto =
  41978**, Valor);
- Mais Ações → **Fiscal** → "Tipo de nota de débito" = **"Pagamento antecipado"** → salvar;
- Mais Ações → **Observações** → gerar observações.
- **Pergunta:** os endpoints (path + payload) de cada passo — de preferência **1 HAR** de uma geração
  real em HML. Confirmar também que produto `41978` / número `0` são fixos.
- **Ação ao responder:** implementar a leg de geração → produz `Recebimento.emissaoNde` (`com297DocCod`
  + `vldTpNf`) → destrava o caminho vivo do `ConexosNdeEmitter`.

## P1 — não bloqueiam, mas confirmam campos/segurança

### G3 · `homologacao-response-fields`
- **Pergunta:** no retorno da homologação, qual campo carrega o **número da NDe** (hoje best-effort
  `docEspNumero`)? E qual o **enum completo** de `docVldComvalidacoes` (só conhecemos 1 e 2)?
- **Ação:** ajustar `HOMOLOGACAO_RESP_SCHEMA` + `NDE_DOC_VLD_COM_VALIDACOES`. Precisa de 1 HAR HML.

### G4 · `acl-com297-homologar`
- **Pergunta / ação:** conceder à **conta de serviço** da automação as ações ACL `HOMOLOGAR DOCUMENTO`
  e `HOMOLOGAR DOCUMENTO CONTINGENCIA` na view `com297`. Confirmar se o servidor **re-checa** server-
  side (403 esperado sem a ação).

## Resolvido (registro)

- ✅ `finDocIsContingenciaHomologacao` — regra conhecida: `["11","12"].indexOf(vldTpNf) !== -1`
  (`11`→DPEC, `12`→SCAN). Implementada **invertida** p/ fail-loud (`ContingenciaDecider`). Não é mais
  um gap — só o **seed** da allowlist normal (G1) resta.
