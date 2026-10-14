'use client'

import { AlertTriangle, Copy } from 'lucide-react'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AutorizacaoApiError,
  CODIGOS_ERRO_SUGESTAO_BOLETO,
  type ChaveSugestaoBoleto,
  confirmarSugestaoBoleto,
  copiarLinhaSugestao,
  rejeitarSugestaoBoleto,
  revogarConfirmacaoEmissor,
  type SugestaoBoleto,
} from '@/lib/sispag'
import { formatBRL } from '@/lib/utils'
import { fmtCivil } from './CandidatosBoletoDialog'
import { MotivoDecisaoDialog } from './MotivoDecisaoDialog'
import {
  formatDeltaDias,
  formatDeltaPercentual,
  formatDeltaValor,
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
    e.code === CODIGOS_ERRO_SUGESTAO_BOLETO.RESERVADO_A_OUTRO_TITULO)

const ATENCAO_CLASSE = 'border-warning/40 text-warning'

function Delta({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque: boolean }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className={destaque ? 'font-medium tabular-nums text-warning' : 'tabular-nums'}>
        {valor}
      </dd>
    </div>
  )
}

type Aviso = { tipo: 'ok' | 'erro'; texto: string }
type Dialogo = { tipo: 'rejeitar' | 'revogar'; sugestao: SugestaoBoleto }

/**
 * Sugestão(ões) de boleto DDA para UM título "boleto sem DDA" (ADR-0068, passo 1). É evidência
 * para a analista decidir — nada é gravado no Conexos e o aviso de "sem boleto DDA" do lote não
 * muda. Permissões escondem as ações (R11): copiar = `sispag:ver`; confirmar, rejeitar e
 * revogar = `sispag:executar`. O backend recusa de qualquer forma.
 */
export function SugestaoBoletoPainel({
  sugestoes,
  podeExecutar,
  podeCopiar,
  ddaDefasadoHoras,
  onDecidido,
}: {
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
      <p className="text-xs text-muted-foreground">
        É uma indicação para você conferir; o Conexos continua sem associar o boleto a este título.
        Confirmar aqui registra a sua decisão e <strong>não grava nada no Conexos</strong>: a
        remessa segue bloqueada até o boleto ser associado no ERP.
      </p>
      {ddaDefasadoHoras !== undefined ? (
        <p className="flex items-start gap-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            O arquivo DDA não é atualizado há {ddaDefasadoHoras} h; a sugestão pode estar
            desatualizada.
          </span>
        </p>
      ) : null}
      {/* Região viva única: o resultado da última ação é anunciado sem roubar o foco. */}
      <div aria-live="polite">
        {aviso ? (
          <p
            role={aviso.tipo === 'erro' ? 'alert' : 'status'}
            className={
              aviso.tipo === 'erro'
                ? 'rounded-lg border border-danger/40 bg-danger-subtle px-3 py-2 text-sm text-danger-foreground'
                : 'rounded-lg border border-success/40 px-3 py-2 text-sm text-success'
            }
          >
            {aviso.texto}
          </p>
        ) : null}
      </div>
      <ul className="flex flex-col gap-3">
        {sugestoes.map((s) => {
          const a = s.avaliacao
          const ocup = ocupado === idItem(s)
          const confirmada = s.estado === 'CONFIRMADA'
          const atencao = a.resultado === 'ATENCAO'
          const vencido = a.resultado === 'VENCIDO_INFORMATIVO'
          const podeConfirmar = a.confirmavel && s.confirmavel && !confirmada
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
                  className={
                    atencao || vencido ? ATENCAO_CLASSE : 'border-success/40 text-success'
                  }
                >
                  {TIER_ROTULO[a.resultado]}
                </Badge>
                {confirmada ? <Badge variant="outline">confirmado</Badge> : null}
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
                      <li key={sinal} className={t.atencao ? 'text-warning' : undefined}>
                        {t.texto}
                      </li>
                    )
                  })}
                </ul>
              ) : null}
              {confirmada ? (
                <p className="mt-2 text-sm">
                  Boleto confirmado{s.emissor ? ` (emissor ${s.emissor.mascarado})` : ''} —{' '}
                  <strong>ainda não associado no ERP</strong>; a remessa continua bloqueada.
                </p>
              ) : null}
              {vencido ? (
                <p className="mt-2 text-sm text-warning">
                  O boleto vence antes da data de débito: serve só como informação.
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {podeExecutar && !confirmada ? (
                  <Button
                    size="sm"
                    disabled={ocup || !podeConfirmar}
                    onClick={() => void confirmar(s)}
                  >
                    Confirmar
                  </Button>
                ) : null}
                {podeExecutar && !confirmada && !vencido ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={ocup}
                    onClick={() => setDialogo({ tipo: 'rejeitar', sugestao: s })}
                  >
                    Rejeitar
                  </Button>
                ) : null}
                {podeCopiar ? (
                  <Button size="sm" variant="outline" disabled={ocup} onClick={() => void copiar(s)}>
                    <Copy className="size-4" aria-hidden /> Copiar linha digitável
                  </Button>
                ) : null}
                {podeExecutar && s.confirmacaoEmissorId ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={ocup}
                    onClick={() => setDialogo({ tipo: 'revogar', sugestao: s })}
                  >
                    Revogar confirmação
                  </Button>
                ) : null}
              </div>
              {podeExecutar && !podeConfirmar && !confirmada ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Confirmar indisponível: {s.motivo ?? 'a regra não permite confirmar esta sugestão.'}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
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
      {dialogo?.tipo === 'revogar' && dialogo.sugestao.confirmacaoEmissorId ? (
        <MotivoDecisaoDialog
          titulo="Revogar confirmação do emissor"
          descricao="O emissor deixa de contar como conhecido para este credor; as sugestões voltam a 'forte'. Nada muda no Conexos. O motivo fica na trilha."
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
