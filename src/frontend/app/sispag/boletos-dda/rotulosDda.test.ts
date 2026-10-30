import { rotuloDaSituacao } from './filtrosBoletosDda'
import { badgeDaSituacao, SITUACAO_BADGE } from './rotulosDda'

describe('situação desconhecida (backend mais novo que o bundle)', () => {
  it('badgeDaSituacao devolve o selo conhecido', () => {
    expect(badgeDaSituacao('VINCULADO')).toBe(SITUACAO_BADGE.VINCULADO)
  })

  it('badgeDaSituacao cai num selo neutro com o valor cru, sem lançar', () => {
    const selo = badgeDaSituacao('NOVA_SITUACAO')
    expect(selo.label).toBe('nova situacao')
    expect(selo.className).toContain('text-muted-foreground')
    expect(selo.title).toMatch(/Recarregue/)
  })

  it('rotuloDaSituacao devolve o rótulo conhecido ou o valor cru', () => {
    expect(rotuloDaSituacao('SEM_TITULO')).toBe('Sem título')
    expect(rotuloDaSituacao('NOVA_SITUACAO')).toBe('NOVA_SITUACAO')
  })
})
