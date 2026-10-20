'use client'

import { AlertTriangle, Copy } from 'lucide-react'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  type AjusteCentavos,
  AutorizacaoApiError,
  CODIGOS_ERRO_SUGESTAO_BOLETO,
  anularConfirmacaoBoleto,
  type ChaveSugestaoBoleto,
  confirmarSugestaoBoleto,
  copiarLinhaSugestao,
  type DesfechoTituloBoleto,
  type ModoAjusteCentavos,
  MOTIVO_ANULACAO_MINIMO,
  rejeitarSugestaoBoleto,
  revogarConfirmacaoEmissor,
  type SugestaoBoleto,
  tentarAjusteCentavos,
} from '@/lib/sispag'
import { formatBRL } from '@/lib/utils'
import { AjusteCentavosSelo } from './AjusteCentavosSelo'
import { fmtCivil } from './CandidatosBoletoDialog'
import { MotivoDecisaoDialog } from './MotivoDecisaoDialog'
import { ReconhecerAvisoDialog } from './ReconhecerAvisoDialog'
import {
  candidatoComoSugestao,
  exigeReconhecimento,
  formatDeltaDias,
  formatDeltaPercentual,
  formatDeltaValor,
  mensagemVenceAntes,
  seloDoAjusteCentavos,
  TEXTO_SINAL,
  TIER_ROTULO,
} from './sugestaoBoleto'

const chaveDe = (s: SugestaoBoleto): ChaveSugestaoBoleto => ({
  filCod: s.filCod,
  docCod: s.docCod,
  titCod: s.titCod,
  ddcCod: s.ddcCod,
  ditCod: s.ditCod,
})

/** Mensagem em português do envelope; nunca expõe nada além dela. */
const mensagemDe = (e: unknown, padrao: string): string => {
  if (e instanceof AutorizacaoApiError) {
    if (e.message) return e.message
    if (e.code === CODIGOS_ERRO_SUGESTAO_BOLETO.SEM_TRILHA)
      return 'Não foi possível registrar a cópia; a linha digitável não foi copiada.'
    if (e.status === 429) return 'Muitas decisões em pouco tempo. Aguarde um instante.'
  }
  return e instanceof Error && e.message ? e.message : padrao
}

/** Erros que indicam que a sugestão na tela está velha: relê a lista depois de explicar. */
const ehSugestaoVelha = (e: unknown): boolean =>
  e instanceof AutorizacaoApiError &&
  (e.code === CODIGOS_ERRO_SUGESTAO_BOLETO.INDISPONIVEL ||
    e.code === CODIGOS_ERRO_SUGESTAO_BOLETO.RESERVADO_A_OUTRO_TITULO ||
    e.code === CODIGOS_ERRO_SUGESTAO_BOLETO.NAO_CONFIRMADA)

const ATENCAO_CLASSE = 'border-warning/40 text-warning-foreground'

/** Cada nível tem um tom explícito: SEM_RELACAO nunca herda o verde de "forte". */
const TIER_CLASSE: Record<SugestaoBoleto['avaliacao']['resultado'], string> = {
  CONHECIDO: 'border-success/40 text-success-foreground',
  FORTE: 'border-success/40 text-success-foreground',
  ATENCAO: ATENCAO_CLASSE,
  VENCIDO_INFORMATIVO: ATENCAO_CLASSE,
  SEM_RELACAO: 'text-muted-foreground',
}

function Delta({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque: boolean }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className={destaque ? 'font-medium tabular-nums text-warning-foreground' : 'tabular-nums'}>
        {valor}
      </dd>
    </div>
  )
}

type Aviso = { tipo: 'ok' | 'erro'; texto: string }
type Dialogo = {
  tipo: 'rejeitar' | 'revogar' | 'anular' | 'reconhecer'
  sugestao: SugestaoBoleto
}

/** Candidato do desfecho que corresponde ao item (para o que a sugestão legada não carrega). */
const candidatoDe = (d: DesfechoTituloBoleto | undefined, s: SugestaoBoleto) =>
  d?.candidatos.find((c) => c.ddcCod === s.ddcCod && c.ditCod === s.ditCod)

const dataHora = (epochMs: number): string =>
  new Date(epochMs).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

/**
 * Sugestão(ões) de boleto DDA para UM título "boleto sem DDA" (ADR-0068, passo 1). É evidência
 * para a analista decidir — nada é gravado no Conexos e o aviso de "sem boleto DDA" do lote não
 * muda. Permissões escondem as ações (R11): copiar = `sispag:ver`; confirmar, rejeitar, anular a
 * confirmação e revogar = `sispag:executar`. O backend recusa de qualquer forma.
 *
 * Confirmação ÓRFÃ (I15l): a decisão segue ativa mas o boleto saiu do pool ou o ERP sinalizou o
 * título; o painel avisa, não oferece confirmar nem copiar, e deixa "Anular confirmação".
 */
export function SugestaoBoletoPainel({
  sugestoes: sugestoesLegadas,
  desfecho,
  sincronizadoEm,
  onAbrirBoletosDda,
  podeExecutar,
  podeCopiar,
  ddaDefasadoHoras,
  onDecidido,
  itemVinculadoEmLoteVivo = false,
  ajusteCentavos,
  modoAjusteCentavos,
}: {
  /** Estado do ajuste de centavos deste título (ledger, ADR-0074), quando houver. */
  ajusteCentavos?: AjusteCentavos | undefined
  /** Modo efetivo do ajuste na filial (`off` por default). */
  modoAjusteCentavos?: ModoAjusteCentavos | undefined
  /**
   * Desfecho do título (ADR-0072): até 3 candidatos com situação e motivo. Sem ele (resposta
   * antiga do backend), o painel mostra as `sugestoes` como antes.
   */
  desfecho?: DesfechoTituloBoleto | undefined
  /** epoch ms da última sincronização do DDA (texto do estado "sem boleto no pool"). */
  sincronizadoEm?: number | undefined
  /** Atalho para a aba "Boletos DDA" quando o título não tem candidato. */
  onAbrirBoletosDda?: (() => void) | undefined
  /**
   * O item deste título já tem o código vinculado num lote vivo (ADR-0071, I17l): anular a
   * confirmação NÃO o desfaz no Conexos — o diálogo avisa.
   */
  itemVinculadoEmLoteVivo?: boolean
  sugestoes: SugestaoBoleto[]
  podeExecutar: boolean
  podeCopiar: boolean
  ddaDefasadoHoras?: number | undefined
  /** Chamado depois de qualquer decisão (ou sugestão velha) para a tela reler a lista. */
  onDecidido: () => void | Promise<void>
}) {
  const [aviso, setAviso] = React.useState<Aviso | null>(null)
  const [ocupado, setOcupado] = React.useState<string | null>(null)
  const [dialogo, setDialogo] = React.useState<Dialogo | null>(null)
  const titleId = React.useId()

  const idItem = (s: SugestaoBoleto) => `${s.ddcCod}:${s.ditCod}`
  const sugestoes = React.useMemo(
    () =>
      desfecho
        ? desfecho.candidatos.map((c) => candidatoComoSugestao(desfecho, c))
        : sugestoesLegadas,
    [desfecho, sugestoesLegadas],
  )

  const confirmar = async (s: SugestaoBoleto) => {
    setOcupado(idItem(s))
    setAviso(null)
    try {
      await confirmarSugestaoBoleto(chaveDe(s))
      setAviso({
        tipo: 'ok',
        texto: 'Boleto confirmado para este título. Nada foi gravado no Conexos.',
      })
      await onDecidido()
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemDe(e, 'Não foi possível confirmar a sugestão.') })
      if (ehSugestaoVelha(e)) await onDecidido()
    } finally {
      setOcupado(null)
    }
  }

  const copiar = async (s: SugestaoBoleto) => {
    setOcupado(idItem(s))
    setAviso(null)
    try {
      // A cópia é auditada no servidor ANTES de a linha sair; sem trilha, nada chega aqui.
      const linha = await copiarLinhaSugestao(chaveDe(s))
      try {
        await navigator.clipboard.writeText(linha)
      } catch {
        setAviso({
          tipo: 'erro',
          texto: 'Não foi possível acessar a área de transferência. A cópia ficou registrada.',
        })
        return
      }
      setAviso({ tipo: 'ok', texto: 'Linha digitável copiada. A cópia ficou registrada.' })
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemDe(e, 'Não foi possível copiar a linha digitável.') })
    } finally {
      setOcupado(null)
    }
  }

  const tentarAjuste = async (s: SugestaoBoleto) => {
    setOcupado(`ajuste:${idItem(s)}`)
    setAviso(null)
    try {
      const r = await tentarAjusteCentavos({
        filCod: s.filCod,
        docCod: s.docCod,
        titCod: s.titCod,
      })
      setAviso({
        tipo: 'ok',
        texto:
          r.etapa === 'concluido'
            ? 'Ajuste de centavos concluído no Conexos.'
            : 'Pedido de ajuste de centavos enviado. Reabra o título para ver o estado atualizado.',
      })
      await onDecidido()
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemDe(e, 'Não foi possível ajustar os centavos.') })
    } finally {
      setOcupado(null)
    }
  }

  const concluirDialogo = async (texto: string) => {
    setDialogo(null)
    setAviso({ tipo: 'ok', texto })
    await onDecidido()
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h3 id={titleId} className="text-sm font-medium">
        Sugestão de boleto
      </h3>
      {desfecho && desfecho.situacao !== 'SEM_CANDIDATO' ? (
        <p className="text-xs text-muted-foreground" data-testid="situacao-titulo">
          {desfecho.motivo}
          {desfecho.totalCandidatos > desfecho.candidatos.length
            ? ` Mostrando ${desfecho.candidatos.length} de ${desfecho.totalCandidatos} candidatos.`
            : ''}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        É uma indicação para você conferir; o Conexos continua sem associar o boleto a este título.
        Confirmar aqui registra a sua decisão e <strong>não grava nada no Conexos</strong>: a
        remessa segue bloqueada até o boleto ser associado no ERP.
      </p>
      {ddaDefasadoHoras !== undefined ? (
        <p className="flex items-start gap-2 text-xs text-warning-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            O arquivo DDA não é atualizado há {ddaDefasadoHoras} h; a sugestão pode estar
            desatualizada.
          </span>
        </p>
      ) : null}
      {/* Região viva única: o resultado da última ação é anunciado sem roubar o foco. */}
      <div role="status">
        {aviso ? (
          <p
            className={
              aviso.tipo === 'erro'
                ? 'rounded-lg border border-danger/40 bg-danger-subtle px-3 py-2 text-sm text-danger-foreground'
                : 'rounded-lg border border-success/40 px-3 py-2 text-sm text-success-foreground'
            }
          >
            {aviso.texto}
          </p>
        ) : null}
      </div>
      {desfecho?.situacao === 'SEM_CANDIDATO' ? (
        <div
          role="status"
          className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground"
        >
          <p>
            Nenhum boleto no pool DDA dentro do envelope (±R$ 10,00 ou 2 %, ±10 dias).
            {sincronizadoEm !== undefined
              ? ` Último arquivo DDA sincronizado em ${dataHora(sincronizadoEm)}`
              : ' O DDA ainda não foi sincronizado'}
            {ddaDefasadoHoras !== undefined ? ` — no pool de há ${ddaDefasadoHoras} h` : ''}.
          </p>
          {onAbrirBoletosDda ? (
            <Button
              size="sm"
              variant="link"
              className="mt-1 h-auto p-0"
              onClick={onAbrirBoletosDda}
            >
              Ver na aba &ldquo;Boletos DDA&rdquo;
            </Button>
          ) : null}
        </div>
      ) : null}
      <ul className="flex flex-col gap-3">
        {sugestoes.map((s) => {
          const a = s.avaliacao
          const ocup = ocupado === idItem(s)
          const confirmada = s.estado === 'CONFIRMADA'
          const orfa = confirmada && s.orfa === true
          const atencao = a.resultado === 'ATENCAO'
          const vencido = a.resultado === 'VENCIDO_INFORMATIVO'
          const podeConfirmar = a.confirmavel && s.confirmavel && !confirmada
          const nome = String(s.numeroBoleto ?? s.ditCod)
          const motivoId = `${titleId}-motivo-${s.ddcCod}-${s.ditCod}`
          const cand = candidatoDe(desfecho, s)
          const vencimentoTitulo = desfecho?.vencimentoTitulo ?? s.vencimentoTitulo
          const dataDebito = desfecho?.dataDebito ?? s.dataDebito
          // Aviso (I15o): sai do Δdias < 0, inclusive em decisão legada sem o sinal gravado.
          const venceAntes = mensagemVenceAntes(
            { avaliacao: a, vencimentoBoleto: s.vencimentoBoleto },
            { vencimentoTitulo, dataDebito },
          )
          const pedeReconhecimento = podeConfirmar && exigeReconhecimento({ avaliacao: a })
          const seloAjuste = seloDoAjusteCentavos({
            sugestao: s,
            ...(ajusteCentavos ? { ajuste: ajusteCentavos } : {}),
            ...(modoAjusteCentavos ? { modo: modoAjusteCentavos } : {}),
          })
          const ocupadoAjuste = ocupado === `ajuste:${idItem(s)}`
          return (
            <li
              key={idItem(s)}
              className={`rounded-lg border p-3 ${atencao ? 'border-warning/40' : ''}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium tabular-nums">
                  Boleto {s.numeroBoleto ?? s.ditCod}
                </span>
                <Badge
                  variant="outline"
                  className={TIER_CLASSE[a.resultado]}
                >
                  {TIER_ROTULO[a.resultado]}
                </Badge>
                {confirmada && !orfa ? <Badge variant="outline">confirmado</Badge> : null}
                {orfa ? (
                  <Badge variant="outline" className={ATENCAO_CLASSE}>
                    confirmação órfã
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 text-sm">
                {formatBRL(s.valorBoleto)} · vence {fmtCivil(s.vencimentoBoleto)}
                {s.emissor ? ` · emissor ${s.emissor.mascarado}` : ''}
              </p>
              <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <Delta
                  rotulo="Valor (boleto − título)"
                  valor={formatDeltaValor(a.deltaValor)}
                  destaque={a.deltaValor !== 0}
                />
                <Delta
                  rotulo="Percentual"
                  valor={formatDeltaPercentual(a.deltaPercentual)}
                  destaque={a.deltaValor !== 0}
                />
                <Delta
                  rotulo="Vencimento (boleto − título)"
                  valor={formatDeltaDias(a.deltaDias)}
                  destaque={a.deltaDias !== 0}
                />
              </dl>
              {a.sinais.length > 0 ? (
                <ul
                  aria-label="Evidências"
                  className="mt-2 list-disc pl-5 text-xs text-muted-foreground"
                >
                  {a.sinais.map((sinal) => {
                    const t = TEXTO_SINAL[sinal]
                    return (
                      <li key={sinal} className={t.atencao ? 'text-warning-foreground' : undefined}>
                        {t.texto}
                      </li>
                    )
                  })}
                </ul>
              ) : null}
              {orfa ? (
                <p className="mt-2 flex items-start gap-2 text-sm text-warning-foreground">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    <strong>Confirmação órfã.</strong>{' '}
                    {s.motivoOrfa ?? 'O boleto confirmado deixou de estar disponível.'} Enquanto
                    ela existir, o título e o boleto ficam presos; anule-a para liberá-los.
                  </span>
                </p>
              ) : null}
              {confirmada && !orfa ? (
                <p className="mt-2 text-sm">
                  Boleto confirmado{s.emissor ? ` (emissor ${s.emissor.mascarado})` : ''} —{' '}
                  <strong>ainda não associado no ERP</strong>; a remessa continua bloqueada.
                </p>
              ) : null}
              {confirmada && s.decididoPor ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  confirmado por {s.decididoPor}
                  {s.transferidaPor
                    ? ' · decisão transferida pelo sistema ao título renegociado'
                    : ''}
                </p>
              ) : null}
              {confirmada ? <AjusteCentavosSelo selo={seloAjuste} /> : null}
              {confirmada && podeExecutar && seloAjuste?.retomavel ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled={ocupadoAjuste}
                  aria-label={`Tentar de novo o ajuste de centavos do título ${s.docCod}/${s.titCod}`}
                  onClick={() => void tentarAjuste(s)}
                >
                  Tentar de novo o ajuste
                </Button>
              ) : null}
              {venceAntes ? (
                <p
                  role="status"
                  className="mt-2 flex items-start gap-2 text-sm text-warning-foreground"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{venceAntes}</span>
                </p>
              ) : vencido ? (
                <p className="mt-2 text-sm text-warning-foreground">
                  O boleto vence antes da data de débito: serve só como informação.
                </p>
              ) : null}
              {cand?.reservadoParaTitulo ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Reservado ao título {cand.reservadoParaTitulo.docCod}/
                  {cand.reservadoParaTitulo.titCod} (fil {cand.reservadoParaTitulo.filCod}).
                </p>
              ) : null}
              {cand?.compartilhado ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Este boleto também aparece como candidato de outro título; nenhum o reserva.
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {podeExecutar && !confirmada && podeConfirmar ? (
                  <Button
                    size="sm"
                    disabled={ocup}
                    aria-label={`Confirmar boleto ${nome}`}
                    onClick={() =>
                      pedeReconhecimento
                        ? setDialogo({ tipo: 'reconhecer', sugestao: s })
                        : void confirmar(s)
                    }
                  >
                    Confirmar
                  </Button>
                ) : null}
                {podeExecutar && !confirmada && !vencido ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={ocup}
                    aria-label={`Rejeitar boleto ${nome}`}
                    onClick={() => setDialogo({ tipo: 'rejeitar', sugestao: s })}
                  >
                    Rejeitar
                  </Button>
                ) : null}
                {podeCopiar && !orfa ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={ocup}
                    aria-label={`Copiar linha digitável do boleto ${nome}`}
                    onClick={() => void copiar(s)}
                  >
                    <Copy className="size-4" aria-hidden /> Copiar linha digitável
                  </Button>
                ) : null}
                {podeExecutar && confirmada ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={ocup}
                    aria-label={`Anular confirmação do boleto ${nome}`}
                    onClick={() => setDialogo({ tipo: 'anular', sugestao: s })}
                  >
                    Anular confirmação
                  </Button>
                ) : null}
                {podeExecutar && s.confirmacaoEmissorId ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={ocup}
                    aria-label={`Revogar confirmação do boleto ${nome}`}
                    onClick={() => setDialogo({ tipo: 'revogar', sugestao: s })}
                  >
                    Revogar confirmação
                  </Button>
                ) : null}
              </div>
              {podeExecutar && !podeConfirmar && !confirmada ? (
                <p id={motivoId} className="mt-1 text-xs text-muted-foreground">
                  Confirmar indisponível:{' '}
                  {s.motivo ?? 'a regra não permite confirmar esta sugestão.'}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
      {dialogo?.tipo === 'reconhecer' ? (
        <ReconhecerAvisoDialog
          mensagem={
            mensagemVenceAntes(
              { avaliacao: dialogo.sugestao.avaliacao, vencimentoBoleto: dialogo.sugestao.vencimentoBoleto },
              {
                vencimentoTitulo: desfecho?.vencimentoTitulo ?? dialogo.sugestao.vencimentoTitulo,
                dataDebito: desfecho?.dataDebito ?? dialogo.sugestao.dataDebito,
              },
            ) ?? 'Este boleto vence antes do título.'
          }
          deltaValor={formatDeltaValor(dialogo.sugestao.avaliacao.deltaValor)}
          deltaDias={formatDeltaDias(dialogo.sugestao.avaliacao.deltaDias)}
          onFechar={() => setDialogo(null)}
          onConfirmar={async () => {
            try {
              await confirmarSugestaoBoleto(chaveDe(dialogo.sugestao), ['VENCE_ANTES_DO_TITULO'])
            } catch (e) {
              throw new Error(mensagemDe(e, 'Não foi possível confirmar a sugestão.'))
            }
            await concluirDialogo(
              'Boleto confirmado para este título. Nada foi gravado no Conexos.',
            )
          }}
        />
      ) : null}
      {dialogo?.tipo === 'rejeitar' ? (
        <MotivoDecisaoDialog
          titulo="Rejeitar sugestão"
          descricao="Este boleto deixa de ser sugerido para este título. O motivo fica na trilha."
          rotuloConfirmar="Rejeitar"
          onFechar={() => setDialogo(null)}
          onConfirmar={async (motivo) => {
            try {
              await rejeitarSugestaoBoleto(chaveDe(dialogo.sugestao), motivo)
            } catch (e) {
              throw new Error(mensagemDe(e, 'Não foi possível rejeitar a sugestão.'))
            }
            await concluirDialogo('Sugestão rejeitada para este título.')
          }}
        />
      ) : null}
      {dialogo?.tipo === 'anular' ? (
        <MotivoDecisaoDialog
          titulo="Anular confirmação do boleto"
          descricao={
            itemVinculadoEmLoteVivo
              ? 'ATENÇÃO: o código de barras deste boleto já foi vinculado ao item do lote. Anular a confirmação NÃO desfaz isso no Conexos: o item continua no lote com o boleto. Para não pagá-lo, retire o título do lote. A confirmação do emissor não muda. O motivo fica na trilha.'
              : 'A confirmação deste título é desfeita e o título e o boleto voltam a ficar livres. A confirmação do emissor não muda. Nada muda no Conexos. O motivo fica na trilha.'
          }
          rotuloConfirmar="Anular confirmação"
          minimoCaracteres={MOTIVO_ANULACAO_MINIMO}
          onFechar={() => setDialogo(null)}
          onConfirmar={async (motivo) => {
            try {
              await anularConfirmacaoBoleto(
                {
                  filCod: dialogo.sugestao.filCod,
                  docCod: dialogo.sugestao.docCod,
                  titCod: dialogo.sugestao.titCod,
                },
                motivo,
              )
            } catch (e) {
              throw new Error(mensagemDe(e, 'Não foi possível anular a confirmação.'))
            }
            await concluirDialogo(
              'Confirmação anulada. O título e o boleto voltaram a ficar livres.',
            )
          }}
        />
      ) : null}
      {dialogo?.tipo === 'revogar' && dialogo.sugestao.confirmacaoEmissorId ? (
        <MotivoDecisaoDialog
          titulo="Revogar confirmação do emissor"
          descricao="O emissor deixa de contar como conhecido para este credor; as sugestões voltam a 'forte' e as confirmações de boleto feitas com ele são anuladas. Nada muda no Conexos. O motivo fica na trilha."
          rotuloConfirmar="Revogar"
          onFechar={() => setDialogo(null)}
          onConfirmar={async (motivo) => {
            try {
              await revogarConfirmacaoEmissor(
                dialogo.sugestao.confirmacaoEmissorId as string,
                motivo,
              )
            } catch (e) {
              throw new Error(mensagemDe(e, 'Não foi possível revogar a confirmação.'))
            }
            await concluirDialogo('Confirmação do emissor revogada.')
          }}
        />
      ) : null}
    </section>
  )
}
