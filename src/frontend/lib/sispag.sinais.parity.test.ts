import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SINAIS_SUGESTAO_BOLETO } from './sispag'

/**
 * PARIDADE DE SINAIS (backend ↔ frontend). `SINAIS_SUGESTAO_BOLETO` espelha à mão o
 * `SINAL_SUGESTAO` do backend e alimenta um `z.enum` FECHADO: um sinal novo só no backend
 * passa o `typecheck` dos dois projetos e estoura em produção como erro de Zod na tela
 * (incidente do QA de 2026-10-27: `DATA_DIVERGENTE_RECONHECIDA`). O teste lê o fonte do
 * backend, como `lib/types.test.ts`, em vez de repetir uma lista aqui.
 */
const BACKEND = join(__dirname, '..', '..', 'backend')

const valoresDoObjeto = (arquivo: string, nome: string): string[] => {
  const src = readFileSync(join(BACKEND, arquivo), 'utf-8')
  const m = src.match(new RegExp(`export const ${nome}\\s*=\\s*\\{([\\s\\S]*?)\\n\\}\\s*as const`))
  if (!m) throw new Error(`${nome} não encontrado em ${arquivo}`)
  return [...(m[1] ?? '').matchAll(/^\s*[A-Z0-9_]+:\s*'([^']+)'/gm)].map((x) => x[1] as string)
}

describe('paridade dos sinais da sugestão de boleto', () => {
  it('SINAIS_SUGESTAO_BOLETO tem exatamente os valores de SINAL_SUGESTAO do backend', () => {
    const backend = valoresDoObjeto('domain/interface/sispag/SugestaoBoleto.ts', 'SINAL_SUGESTAO')
    expect(backend.length).toBeGreaterThan(10)
    expect([...SINAIS_SUGESTAO_BOLETO].sort()).toEqual([...backend].sort())
  })
})
