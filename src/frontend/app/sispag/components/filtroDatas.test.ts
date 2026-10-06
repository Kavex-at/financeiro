import { diaDoErp, diaEmBrasilia } from './filtroDatas'

describe('diaDoErp', () => {
  it('lê o dia ERP (meia-noite UTC) sem passar por fuso', () => {
    expect(diaDoErp(Date.UTC(2026, 9, 6))).toBe('2026-10-06')
  })
  it('ausente → undefined', () => {
    expect(diaDoErp(undefined)).toBeUndefined()
  })
})

describe('diaEmBrasilia', () => {
  it('instante ISO vira o dia em Brasília (23h BRT ainda é o mesmo dia)', () => {
    // 2026-10-07T01:30Z = 06/10 22:30 em Brasília
    expect(diaEmBrasilia('2026-10-07T01:30:00Z')).toBe('2026-10-06')
  })
  it('aceita epoch ms', () => {
    expect(diaEmBrasilia(Date.UTC(2026, 9, 6, 15))).toBe('2026-10-06')
  })
  it('ausente ou inválido → undefined', () => {
    expect(diaEmBrasilia(undefined)).toBeUndefined()
    expect(diaEmBrasilia('lixo')).toBeUndefined()
  })
})
