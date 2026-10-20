import {
  type CriarLotesPorFilialResult,
  type LoteCriadoPorFilial,
  RESULTADO_LOTE_FILIAL,
} from '@/lib/sispag'

export interface ResumoResultadoLotes {
  criados: number
  parciais: number
  recusados: number
  titulosIncluidos: number
  titulosRecusados: number
  /** Tom do toast: tudo certo, atenção (parcial/recusa) ou nada entrou. */
  tom: 'sucesso' | 'aviso' | 'erro'
  titulo: string
}

/** Resume o que o servidor devolveu, para o toast e para o título do diálogo de resultado. */
export const resumirResultadoLotes = (r: CriarLotesPorFilialResult): ResumoResultadoLotes => {
  const conta = (res: LoteCriadoPorFilial['resultado']) => r.lotes.filter((l) => l.resultado === res).length
  const criados = conta(RESULTADO_LOTE_FILIAL.CRIADO)
  const parciais = conta(RESULTADO_LOTE_FILIAL.PARCIAL)
  const recusados = conta(RESULTADO_LOTE_FILIAL.RECUSADO)
  const titulosIncluidos = r.lotes.reduce((acc, l) => acc + l.incluidos.length, 0)
  const titulosRecusados = r.lotes.reduce((acc, l) => acc + l.recusados.length, 0)
  const nasceu = criados + parciais
  const tom = nasceu === 0 ? 'erro' : parciais > 0 || recusados > 0 || titulosRecusados > 0 ? 'aviso' : 'sucesso'
  const titulo =
    nasceu === 0
      ? 'Nenhum lote foi criado'
      : tom === 'sucesso'
        ? `${nasceu} lote${nasceu > 1 ? 's criados' : ' criado'} com ${titulosIncluidos} título(s)`
        : `${nasceu} lote${nasceu > 1 ? 's criados' : ' criado'}, mas ${titulosRecusados} título(s) não entraram`
  return { criados, parciais, recusados, titulosIncluidos, titulosRecusados, tom, titulo }
}
