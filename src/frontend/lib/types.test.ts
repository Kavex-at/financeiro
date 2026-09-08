import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * PARIDADE DE UNIÕES ESPELHADAS À MÃO (backend ↔ frontend).
 *
 * `lib/types.ts` duplica, em texto, uniões que nascem no backend. Os dois projetos são
 * compilados separadamente, então **nada força a paridade no compilador**: acrescentar um
 * estado só de um lado passa `typecheck` nos dois e só falha em produção, como um badge que
 * cai no `else` errado ou um `status` que a UI não sabe desenhar.
 *
 * Este teste é a única guarda possível. Ele LÊ O ARQUIVO-FONTE DO BACKEND e compara os
 * literais — não uma lista copiada aqui, que teria o mesmo defeito que pretende evitar.
 *
 * Origem de cada união:
 *   - `ExecucaoStatus`       → src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts
 *   - `PermutaStatusBordero` → src/backend/domain/service/permutas/BorderoGestaoService.ts
 *     (lá se chama `PermutaStatus`)
 */

const BACKEND = join(__dirname, '..', '..', 'backend')

/** Extrai os literais de string de `export type <nome> = 'a' | 'b' | ...` (multi-linha). */
const unionLiterals = (file: string, typeName: string): string[] => {
    const source = readFileSync(join(BACKEND, file), 'utf-8')
    const match = source.match(new RegExp(`export type ${typeName}\\s*=([^;]+);`))
    if (!match) throw new Error(`união ${typeName} não encontrada em ${file}`)
    return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
}

/** Idem, para uma união declarada no PRÓPRIO frontend. */
const frontendUnionLiterals = (typeName: string): string[] => {
    const source = readFileSync(join(__dirname, 'types.ts'), 'utf-8')
    // Para em `\n\n` (a primeira linha em branco) — cobre tanto a união de uma linha quanto a
    // quebrada em `| valor` pelo formatador.
    const match = source.match(new RegExp(`export type ${typeName}\\s*=([\\s\\S]*?)\\n\\n`))
    if (!match) throw new Error(`união ${typeName} não encontrada em lib/types.ts`)
    return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
}

describe('paridade das uniões espelhadas à mão (backend ↔ frontend)', () => {
    it('ExecucaoStatus é idêntico ao do PermutaExecucaoRepository', () => {
        const backend = unionLiterals(
            'domain/repository/permutas/PermutaExecucaoRepository.ts',
            'ExecucaoStatus',
        )
        expect(backend).toEqual(['error', 'parcial', 'pending', 'reconciling', 'settled'])
        expect(frontendUnionLiterals('ExecucaoStatus')).toEqual(backend)
    })

    it('PermutaStatusBordero é idêntico ao PermutaStatus do BorderoGestaoService', () => {
        const backend = unionLiterals(
            'domain/service/permutas/BorderoGestaoService.ts',
            'PermutaStatus',
        )
        expect(backend).toEqual([
            'aguardando-finalizacao',
            'finalizado',
            'parcial-aguardando-finalizacao',
        ])
        expect(frontendUnionLiterals('PermutaStatusBordero')).toEqual(backend)
    })

    it('LoteAdiantamentoStatus é idêntico ao do ReconciliacaoLotePermutaService (C-5)', () => {
        // O `parcial` DESTA união é OUTRA COISA: significa "alguns pares do adto deram settled,
        // outros deram error" — status agregado do ADIANTAMENTO no lote. O `parcial` de
        // `ExecucaoStatus` é o desfecho de UM par (baixou em parte). Coexistem de propósito; o
        // teste existe para que a colisão de nome seja explícita e não vire unificação acidental.
        const backend = unionLiterals(
            'domain/service/permutas/ReconciliacaoLotePermutaService.ts',
            'LoteAdiantamentoStatus',
        )
        expect(frontendUnionLiterals('LoteAdiantamentoStatus')).toEqual(backend)
    })
})
