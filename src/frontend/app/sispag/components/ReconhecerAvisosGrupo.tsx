'use client'

import { AVISO_TITULO_VENCE_ANTES_DO_BOLETO, formatCentavos } from './grupoBoleto'
import { ReconhecerAvisoDialog } from './ReconhecerAvisoDialog'
import { formatDate } from '@/lib/utils'

const TEXTO_RECONHECIMENTO_TITULO_ANTES =
  'Entendo que um título vence antes do boleto e que pagar na data do boleto pode gerar atraso, juros e multa.'

/** O que a pessoa está reconhecendo (a tela calcula; o servidor reavalia tudo ao confirmar). */
export interface ResumoAvisosGrupo {
  /** Títulos que vencem antes do boleto. */
  quantidadeTitulosAntes: number
  /** Data civil `YYYY-MM-DD`. */
  vencimentoBoleto: string
  /** Soma dos títulos − boleto, em centavos. */
  diferencaCentavos: number
  maiorAntecedenciaDias: number
}

/**
 * Reconhecimento dos avisos da I21i antes de confirmar um grupo (ADR-0077): o mesmo diálogo para a
 * composição manual, a gaveta do título e a linha do boleto. Hoje o único aviso é o de título que
 * vence antes do boleto; os códigos reconhecidos voltam em `onConfirmar` para irem em
 * `reconheceAvisos`.
 */
export function ReconhecerAvisosGrupo({
  avisos,
  resumo,
  onFechar,
  onConfirmar,
}: {
  avisos: readonly string[]
  resumo: ResumoAvisosGrupo
  onFechar: () => void
  /** Rejeita com a mensagem em português para o diálogo mostrar e continuar aberto. */
  onConfirmar: (reconhecidos: string[]) => Promise<void>
}) {
  return (
    <ReconhecerAvisoDialog
      titulo="Título vence antes do boleto"
      textoReconhecimento={TEXTO_RECONHECIMENTO_TITULO_ANTES}
      rotuloDeltaValor="Soma dos títulos − boleto"
      rotuloDeltaDias="Maior antecedência do título"
      mensagem={`${resumo.quantidadeTitulosAntes} título(s) vencem antes do boleto (${formatDate(resumo.vencimentoBoleto)}).`}
      deltaValor={formatCentavos(resumo.diferencaCentavos)}
      deltaDias={`${resumo.maiorAntecedenciaDias} dias`}
      onFechar={onFechar}
      onConfirmar={() =>
        onConfirmar(avisos.length > 0 ? [...avisos] : [AVISO_TITULO_VENCE_ANTES_DO_BOLETO])
      }
    />
  )
}
