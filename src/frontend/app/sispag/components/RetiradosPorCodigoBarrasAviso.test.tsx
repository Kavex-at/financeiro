/**
 * Aviso persistente da retirada automática por código de barras (ADR-0069 emenda 1, I16f(3)):
 * o que saiu do lote, com favorecido, valor, vencimento, código MASCARADO e o título que ficou.
 */
import { render, screen } from '@testing-library/react'
import type { RetiradaDoLote } from '@/lib/sispag'
import { RetiradosPorCodigoBarrasAviso } from './RetiradosPorCodigoBarrasAviso'

// Código SINTÉTICO de 44 dígitos: nenhum nó do DOM pode carregá-lo.
const BARRAS = '34191158000001412001090047729099260408340000'

const repetido: RetiradaDoLote = {
  titulo: { filCod: 2, docCod: '1001', titCod: '1' },
  motivo: 'CODIGO_BARRAS_REPETIDO',
  credor: 'PEDRONI',
  valor: 1412,
  vencimento: '2026-10-14',
  codigoMascarado: '34191…0000',
  tituloMantido: { filCod: 2, docCod: '1000', titCod: '1' },
  ocorridoEm: '2026-10-14T10:00:00.000Z',
}

describe('RetiradosPorCodigoBarrasAviso', () => {
  it('sem retiradas não renderiza nada', () => {
    const { container } = render(<RetiradosPorCodigoBarrasAviso retiradas={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lista título, favorecido, valor, vencimento, código mascarado e o título que ficou', () => {
    render(<RetiradosPorCodigoBarrasAviso retiradas={[repetido]} />)
    const aviso = screen.getByRole('status')
    expect(aviso).toHaveTextContent('1 título foi retirado deste lote automaticamente')
    expect(aviso).toHaveTextContent('1001/1')
    expect(aviso).toHaveTextContent('PEDRONI')
    expect(aviso).toHaveTextContent('1.412,00')
    expect(aviso).toHaveTextContent('venc. 14/10')
    expect(aviso).toHaveTextContent('código 34191…0000')
    expect(aviso).toHaveTextContent('ficou 1000/1')
  })

  it('distingue boleto repetido de código ilegível', () => {
    render(
      <RetiradosPorCodigoBarrasAviso
        retiradas={[
          repetido,
          {
            titulo: { filCod: 2, docCod: '1002', titCod: '1' },
            motivo: 'CODIGO_BARRAS_ILEGIVEL',
            ocorridoEm: '2026-10-14T10:00:00.000Z',
          },
        ]}
      />,
    )
    const aviso = screen.getByRole('status')
    expect(aviso).toHaveTextContent('2 títulos foram retirados deste lote automaticamente')
    expect(aviso).toHaveTextContent('O mesmo boleto aparecia em mais de um título do lote')
    expect(aviso).toHaveTextContent('O código de barras do boleto está ilegível ou inválido')
    expect(aviso).toHaveTextContent('1002/1')
  })

  it('nunca renderiza o código completo, nem de campo extra que a API mande', () => {
    const hostil = { ...repetido, codigo: BARRAS, linhaDigitavel: BARRAS } as RetiradaDoLote
    const { container } = render(<RetiradosPorCodigoBarrasAviso retiradas={[hostil]} />)
    const html = container.innerHTML
    expect(html).not.toContain(BARRAS)
    expect(html).not.toMatch(/\d{10,}/)
    // `title`/`aria-label` também.
    for (const el of container.querySelectorAll('[title],[aria-label]')) {
      expect(el.getAttribute('title') ?? '').not.toMatch(/\d{10,}/)
      expect(el.getAttribute('aria-label') ?? '').not.toMatch(/\d{10,}/)
    }
  })
})
