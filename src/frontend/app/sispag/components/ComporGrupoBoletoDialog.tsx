'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { confirmarGrupoBoleto } from '@/lib/sispag'
import { formatDate } from '@/lib/utils'
import {
  AVISO_TITULO_VENCE_ANTES_DO_BOLETO,
  avaliarTituloNaComposicao,
  formatCentavos,
  somarComposicao,
} from './grupoBoleto'
import { ReconhecerAvisosGrupo } from './ReconhecerAvisosGrupo'

/** O boleto escolhido (do pool DDA) para o qual a analista compõe o grupo. */
export interface BoletoParaComposicao {
  ddcCod: number
  ditCod: number
  credor?: string
  /** Só a máscara 5+4. */
  codbarMascarado: string
  valorBoletoCentavos: number
  /** Data civil `YYYY-MM-DD`. */
  vencimentoBoleto: string
}

/** Um título candidato (do mesmo credor e filial do boleto). */
export interface TituloParaComposicao {
  filCod: number
  docCod: string
  titCod: string
  valorCentavos: number
  /** Data civil `YYYY-MM-DD`. */
  vencimento: string
}

const chave = (t: { filCod: number; docCod: string; titCod: string }): string =>
  `${t.filCod}:${t.docCod}:${t.titCod}`


/**
 * Composição manual do boleto agrupado (ADR-0077, I21g): a analista escolhe os títulos de UM
 * boleto. A soma aparece ao vivo, com a diferença em centavos, e só fecha quando é exata; título
 * fora da janela de 10 dias não se escolhe (com o motivo); título que vence antes do boleto exige
 * reconhecimento explícito — o servidor revalida tudo. Nada é escrito no ERP.
 */
export function ComporGrupoBoletoDialog({
  boleto,
  candidatos,
  onFechar,
  onConfirmado,
}: {
  boleto: BoletoParaComposicao
  candidatos: TituloParaComposicao[]
  onFechar: () => void
  onConfirmado: () => void | Promise<void>
}) {
  const [marcados, setMarcados] = React.useState<ReadonlySet<string>>(new Set())
  const [reconhecendo, setReconhecendo] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const [salvando, setSalvando] = React.useState(false)
  const idBase = React.useId()

  const avaliados = candidatos.map((t) => ({
    titulo: t,
    avaliacao: avaliarTituloNaComposicao({
      vencimentoBoleto: boleto.vencimentoBoleto,
      vencimentoTitulo: t.vencimento,
    }),
  }))
  const escolhidos = avaliados.filter((a) => marcados.has(chave(a.titulo)))
  const soma = somarComposicao(
    escolhidos.map((a) => a.titulo.valorCentavos),
    boleto.valorBoletoCentavos,
  )
  const antesDoBoleto = escolhidos.filter((a) => a.avaliacao.venceAntesDoBoleto)
  const podeConfirmar = escolhidos.length >= 2 && soma.fecha && !salvando

  const alternar = (t: TituloParaComposicao, v: boolean) =>
    setMarcados((atual) => {
      const next = new Set(atual)
      if (v) next.add(chave(t))
      else next.delete(chave(t))
      return next
    })

  const enviar = async (reconheceAvisos?: readonly string[]) => {
    setErro(null)
    setSalvando(true)
    try {
      await confirmarGrupoBoleto({
        origem: 'MANUAL',
        ddcCod: boleto.ddcCod,
        ditCod: boleto.ditCod,
        titulos: escolhidos.map((a) => ({
          filCod: a.titulo.filCod,
          docCod: a.titulo.docCod,
          titCod: a.titulo.titCod,
        })),
        ...(reconheceAvisos && reconheceAvisos.length > 0 ? { reconheceAvisos } : {}),
      })
      await onConfirmado()
    } catch (e) {
      throw new Error(e instanceof Error && e.message ? e.message : 'Não foi possível confirmar o grupo.')
    } finally {
      setSalvando(false)
    }
  }

  const confirmar = async () => {
    if (!podeConfirmar) return
    if (antesDoBoleto.length > 0) {
      setReconhecendo(true)
      return
    }
    try {
      await enviar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível confirmar o grupo.')
    }
  }

  const maiorAntecedencia = Math.max(0, ...antesDoBoleto.map((a) => a.avaliacao.deltaDias))

  return (
    <>
      <Dialog
        open
        onOpenChange={(aberto) => {
          if (!aberto && !salvando) onFechar()
        }}
      >
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Compor boleto agrupado</DialogTitle>
            <DialogDescription>
              Escolha os títulos que este boleto paga juntos. A soma tem de bater com o boleto, ao
              centavo. Nada é escrito no ERP.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Credor</dt>
                <dd className="font-medium">{boleto.credor ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Boleto</dt>
                <dd className="font-medium tabular-nums">{boleto.codbarMascarado}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Valor do boleto</dt>
                <dd className="font-medium tabular-nums">
                  {formatCentavos(boleto.valorBoletoCentavos)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Vencimento do boleto</dt>
                <dd className="font-medium tabular-nums">{formatDate(boleto.vencimentoBoleto)}</dd>
              </div>
            </dl>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Títulos do credor</legend>
              <ul className="flex flex-col gap-2">
                {avaliados.map(({ titulo, avaliacao }) => {
                  const id = `${idBase}-${chave(titulo)}`
                  return (
                    <li key={chave(titulo)} className="flex items-start gap-2">
                      <Checkbox
                        id={id}
                        checked={marcados.has(chave(titulo))}
                        disabled={avaliacao.foraDaJanela || salvando}
                        onCheckedChange={(v) => alternar(titulo, v === true)}
                      />
                      <div className="flex flex-col">
                        <Label htmlFor={id} className="text-sm font-normal tabular-nums">
                          {titulo.docCod}/{titulo.titCod} · {formatCentavos(titulo.valorCentavos)} ·{' '}
                          {formatDate(titulo.vencimento)}
                        </Label>
                        {avaliacao.foraDaJanela ? (
                          <span className="text-xs text-muted-foreground">
                            {avaliacao.motivoForaDaJanela}
                          </span>
                        ) : avaliacao.venceAntesDoBoleto ? (
                          <span className="text-xs text-warning-foreground">
                            {avaliacao.deltaDias} dias antes do boleto
                          </span>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </fieldset>

            <div aria-live="polite" className="space-y-1 text-sm">
              <p>
                Soma selecionada:{' '}
                <strong className="tabular-nums">{formatCentavos(soma.somaCentavos)}</strong>
              </p>
              <p className={soma.fecha ? 'text-success-foreground' : 'text-warning-foreground'}>
                Diferença:{' '}
                <strong className="tabular-nums">{formatCentavos(soma.diferencaCentavos)}</strong>
              </p>
            </div>

            {antesDoBoleto.length > 0 ? (
              <p role="status" className="text-sm text-warning-foreground">
                Título que vence antes do boleto: você vai precisar reconhecer o risco de atraso
                ao confirmar.
              </p>
            ) : null}
            {erro ? (
              <p
                role="alert"
                className="rounded-lg border border-danger/40 bg-danger-subtle px-4 py-3 text-sm text-danger-foreground"
              >
                {erro}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar} disabled={salvando}>
              Cancelar
            </Button>
            <Button type="button" disabled={!podeConfirmar} onClick={() => void confirmar()}>
              {salvando ? <Spinner aria-hidden /> : null}
              Confirmar grupo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {reconhecendo ? (
        <ReconhecerAvisosGrupo
          avisos={[AVISO_TITULO_VENCE_ANTES_DO_BOLETO]}
          resumo={{
            quantidadeTitulosAntes: antesDoBoleto.length,
            vencimentoBoleto: boleto.vencimentoBoleto,
            diferencaCentavos: soma.diferencaCentavos,
            maiorAntecedenciaDias: maiorAntecedencia,
          }}
          onFechar={() => setReconhecendo(false)}
          onConfirmar={async (reconhecidos) => {
            await enviar(reconhecidos)
            setReconhecendo(false)
          }}
        />
      ) : null}
    </>
  )
}
