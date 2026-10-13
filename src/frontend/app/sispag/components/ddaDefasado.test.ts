import { DDA_DEFASADO_HORAS, horasDdaDefasado } from './ddaDefasado'

const BASE = Date.parse('2026-10-13T12:00:00Z') // terça-feira
const h = (n: number) => n * 60 * 60 * 1000

describe('horasDdaDefasado', () => {
  it('em dia útil: até o limite não alerta, acima devolve as horas', () => {
    const agora = new Date(BASE)
    expect(horasDdaDefasado(BASE - h(DDA_DEFASADO_HORAS), agora)).toBeUndefined()
    expect(horasDdaDefasado(BASE - h(DDA_DEFASADO_HORAS + 1), agora)).toBe(DDA_DEFASADO_HORAS + 1)
    expect(horasDdaDefasado(BASE - h(120), agora)).toBe(120)
  })

  it('aceita o ISO que a API devolve', () => {
    const agora = new Date(BASE)
    expect(horasDdaDefasado(new Date(BASE - h(30)).toISOString(), agora)).toBe(30)
  })

  it('nunca sincronizado ou data ilegível: sem alerta (a tela já diz "não sincronizado")', () => {
    const agora = new Date(BASE)
    expect(horasDdaDefasado(undefined, agora)).toBeUndefined()
    expect(horasDdaDefasado('não-é-data', agora)).toBeUndefined()
  })

  it('fim de semana (em Brasília) não alerta: o banco não manda arquivo', () => {
    const sabado = new Date('2026-10-17T15:00:00Z')
    const domingo = new Date('2026-10-18T15:00:00Z')
    expect(horasDdaDefasado(sabado.getTime() - h(50), sabado)).toBeUndefined()
    expect(horasDdaDefasado(domingo.getTime() - h(50), domingo)).toBeUndefined()
  })

  it('usa o dia em Brasília: segunda 01:00 BRT (04:00Z) ainda é segunda; domingo 22:00 BRT é domingo', () => {
    const segunda = new Date('2026-10-12T04:00:00Z')
    expect(horasDdaDefasado(segunda.getTime() - h(40), segunda)).toBe(40)
    const domingoNoite = new Date('2026-10-12T01:00:00Z') // domingo 22:00 BRT
    expect(horasDdaDefasado(domingoNoite.getTime() - h(40), domingoNoite)).toBeUndefined()
  })
})
