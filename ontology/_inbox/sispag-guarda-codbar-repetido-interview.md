## Interview Transcript — sispag-guarda-codbar-repetido — 2026-10-14 (DRAFT, pré-preenchido)

**Mode:** tweak
**Entity affected:** business-rule `boleto-exige-codigo-de-barras` (ADR-0040) + `RemessaService.gerarRemessaSerializado` (item de lote BOLETO, `lote_pagamento`)
**Status:** rascunho sem Yuri; respostas marcadas com fonte. Só as perguntas da seção final estão abertas.

### Q1. Comportamento atual
- A única guarda é de AUSÊNCIA: `modalidade = BOLETO ∧ ¬temBoletoDda ⇒ BoletoSemCodigoBarrasError` (409), lida ao vivo no envio, antes de qualquer escrita. [repo: RemessaService.ts ~1060-1090; ontology/business-rules/boleto-exige-codigo-de-barras.md]
- Não há guarda de REPETIÇÃO: dois itens do mesmo lote (ou de lotes vivos distintos) com o mesmo `itsNumCodbar` seguem até o `.REM` e pagam o mesmo boleto duas vezes. [repo + evidence: fault-tolerance-5 em sispag-sugestao-boleto-dda-regis-followups.md; F-6 do regis-review 2026-10-14-1330]
- Causa raiz: `titVldReflexoDdaAssoc` = "existe boleto DDA com mesmo valor e vencimento", não reserva 1:1. 27 títulos flagados em grupos com mais títulos que boletos (PEDRONI: 10 títulos de R$ 1.412,00 venc. 14/10, 2 boletos, fil 2). O ERP anexa o mesmo codbar a cada item importado. [evidence]
- O codbar só existe DEPOIS de `importarTitulos` (`itsNumCodbar`, 47 dígitos; `titEspCodbar` nulo em 100%). [evidence; repo: boleto-exige-codigo-de-barras.md "Por que"]
- O validador do `.REM` já lê os segmentos J e confere DV, mas não compara codbar entre segmentos. [repo: RemessaCnabValidator + RemessaService ~677]

### Q2. Comportamento desejado
- O mesmo boleto (codbar normalizado) nunca sai duas vezes: nem dentro do mesmo lote/remessa, e idealmente nem de outro lote vivo. [intent]

### Q3. Bug de implementação ou mudança de regra?
- É **lacuna de invariante**, não regressão: a regra vigente cobre ausência e nunca prometeu unicidade. Logo: **nova invariante** (rule change, additive) na regra `boleto-exige-codigo-de-barras` ou em regra irmã (ex. `boleto-codbar-unico`), com ADR curto. Não há conflito com invariante existente; é complemento da ADR-0063 (duplicidade por TÍTULO) para duplicidade por BOLETO. [inferido]
- Invariantes tocadas: "nada de pagamento duplicado" (I13g/ADR-0063), "falhar antes de escrever" (ADR-0040), human-in-the-loop (a solução não decide qual título fica com o boleto). [repo: ADR-0063, ADR-0040]

### Q4. ONDE checar
- **Camada 1 (principal): logo após `importarTitulos`, antes de `finalizarLote`**, usando `listarLinhasDigitaveisDoLote` (lê `itsNumCodbar` dos itens do lote nativo; devolve `itens`, `total`, `dropped`). Motivo: é o primeiro ponto em que o codbar existe e o último antes de o lote nativo virar FINALIZADO (rascunho nativo não se apaga por API; finalizado se cancela). [repo: RemessaService.ts ~610-623; ConexosSispagWriteClient.ts:593; evidence]
- **Camada 2 (defesa em profundidade): `RemessaCnabValidator`** compara o 44 dígitos dos segmentos J do `.REM` gerado e emite inválido/aviso por codbar repetido. Pega o caso em que a camada 1 foi pulada (retomada de etapa) ou a leitura dropou itens. Falha tardia: lote nativo fica finalizado e arquivo no ERP para cancelamento manual (comportamento já existente do gate 5.1). [repo: RemessaService ~5.1; RemessaCorrompidaError]
- Recomendação: **ambas**. Camada 1 evita resíduo; camada 2 é a rede.
- Normalização: comparar sempre pelo código de 44 dígitos (converter linha digitável 47 → barras 44), porque o J carrega 44 e `itsNumCodbar` carrega 47. [repo: `LINHA_DIGITAVEL_SCHEMA`; evidence]

### Q5. ESCOPO da checagem
- **Dentro do lote**: obrigatório, barato (uma leitura já existente). [inferido]
- **Entre lotes vivos da mesma filial/conta**: desejável (evidência: o mesmo boleto pode cair em 2 lotes por vencimento, ADR-0064); exige ler outros lotes nativos ou persistir hash local. Ver pergunta P0-2.
- **Contra boletos já pagos (RETORNADO/baixado)**: fora do escopo desta entrega; o título pago sai da carteira pelo ERP. Registrar como follow-up. [inferido]

### Q6. O que fazer num acerto
- A solução **não decide** qual título fica com o boleto (julgamento financeiro; invariante human-in-the-loop). Portanto **não** descartar o item "de trás" em silêncio. [repo: CLAUDE.md invariantes; inferido]
- Recomendado: abortar a geração da remessa com erro nomeado (409, nome em inglês, ex. `BoletoCodigoBarrasRepetidoError`, padrão irmão de `BoletoSemCodigoBarrasError`), mensagem pt-BR citando os títulos (`docCod/titCod`, valor, vencimento) e o codbar mascarado. Ver P0-1 sobre o resíduo.

### Q7. Lote manual × automático
- A geração de remessa é a mesma para ambos (`gerarRemessaSerializado`); a guarda vale igual. Sem exceção por origem. [repo: RemessaService.ts; inferido]

### Q8. O que persistir
- Nunca o codbar completo em log/audit: usar forma **mascarada** (primeiros 5 + últimos 4) nas mensagens e logs; para guarda entre lotes, se persistir, **hash salgado** (HMAC com segredo do EnvironmentProvider), nunca texto claro. [inferido; repo: política de log do projeto]
- Se a guarda for só dentro do lote, **nada novo é persistido** (leitura ao vivo do ERP) — sem migration. [inferido]

### Q9. Permissão / auditoria
- Sem nova permissão: roda dentro de `gerarRemessa`, que já exige a permissão SISPAG de gerar remessa. Auditar o bloqueio (LogService warn + registro no ledger de idempotência com `status=failed` e motivo), com títulos e codbar mascarado. [repo: ledger em RemessaService; inferido]

### Q10. Caso canônico
- Grupo PEDRONI (fil 2): 10 títulos R$ 1.412,00 venc. 14/10 para 2 boletos. Após `importarTitulos`, 10 itens com apenas 2 codbar distintos ⇒ 8 repetições ⇒ erro. Em teste usar codbar SINTÉTICOS (47 dígitos com DV válido), nunca o real. [evidence]
- Casos adicionais: (a) todos distintos ⇒ passa; (b) item BOLETO sem codbar + outro com ⇒ segue regra de ausência; (c) codbar `dropped` (DV inválido) ⇒ ver P1-1; (d) retomada na etapa `finalizar` (importar pulado) ⇒ camada 2 ainda pega.

### Interação com ADR-0068 passo 2
- O passo 2 (vincular o codbar de um boleto confirmado ao título) passa pelo MESMO caminho de import; sem esta guarda, confirmar o mesmo boleto para N títulos reproduz o PEDRONI por ação humana. Portanto esta guarda é **pré-requisito** do passo 2 (já anotado no followup). A guarda deve operar sobre `itsNumCodbar` pós-import, independente de como o codbar chegou (DDA flagado ou confirmação). [repo: ADR-0068; followups fault-tolerance-5]

### Perguntas abertas

**P0-1. O que fazer no acerto dado que rascunho nativo não pode ser apagado?**
- (a) *Recomendado:* abortar antes de `finalizarLote`, marcar o ledger como falha com motivo, deixar o rascunho nativo e orientar a analista a tirar o(s) título(s) repetido(s) do lote local (reuso de `DuplicateResolutionService`/RETIRAR) e gerar de novo — a retomada deve reaproveitar o rascunho. 
- (b) Abortar e tentar remover os itens repetidos do rascunho via API (só se o ERP permitir; não verificado).
- (c) Seguir só com um item por codbar e deixar os demais fora (viola human-in-the-loop; não recomendado).

**P0-2. Escopo entre lotes vivos nesta entrega?**
- (a) *Recomendado:* só dentro do lote + camada 2 no `.REM` agora; entre lotes como follow-up (exige persistência de hash, migration e ADR próprio).
- (b) Também entre lotes: ler `itsNumCodbar` dos demais lotes nativos abertos/finalizados da filial+banco no momento do envio (sem persistência, mais chamadas ao ERP).
- (c) Persistir hash salgado do codbar por item enviado (guarda também contra reenvio após RETORNADO).

**P1-1. Codbar `dropped` (presente mas com DV inválido) na camada 1**
- (a) *Recomendado:* fail-closed: `dropped > 0` num lote com BOLETO bloqueia a comparação confiável e aborta com erro nomeado/mensagem própria.
- (b) Ignorar na camada 1 e deixar a camada 2 (DV do J) decidir.

**P1-2. Onde registrar a regra**
- (a) *Recomendado:* nova invariante na regra `boleto-exige-codigo-de-barras` + ADR curto (0069) referenciando ADR-0040/0063/0068.
- (b) Nova regra `boleto-codbar-unico.md`.

### Resumo
Adicionar guarda de unicidade de codbar no envio da remessa SISPAG: após o import e antes de finalizar, comparar os `itsNumCodbar` normalizados (44 dígitos) do lote e abortar com erro nomeado 409 citando os títulos repetidos; repetir a verificação nos segmentos J do `.REM` como rede de segurança. Não decide qual título fica com o boleto (analista resolve). Sem persistência nem nova permissão no recomendado. Pré-requisito do passo 2 da ADR-0068.

### entity_changed: true
(nova invariante/regra e novo erro de domínio na ontologia; nenhuma entidade ou coluna nova no escopo recomendado)
### Ontology diff needed: yes
Adicionar invariante de unicidade de codbar à regra `boleto-exige-codigo-de-barras` (ou regra irmã), erro `BoletoCodigoBarrasRepetidoError`, ADR curto; bump da versão da ontologia (conferir na main antes, ver memória "versão colide entre sessões").
### Reason: rule change (nova invariante aditiva; não é implementation bug)
### Hand off: OntologyCurator
