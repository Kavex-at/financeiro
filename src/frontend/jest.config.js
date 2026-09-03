/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'jsdom',
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
    testMatch: ['<rootDir>/**/*.test.ts', '<rootDir>/**/*.test.tsx'],
    testPathIgnorePatterns: ['/node_modules/', '/.next/'],
    setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/$1',
    },
    // testability-3: medir cobertura de TODO o código-fonte, não só dos arquivos
    // importados por testes (antes o número era "Potemkin" — ~10 de 34 fontes). Exclui
    // testes, type-defs e o `types.ts` (só tipos, sem código executável).
    collectCoverageFrom: [
        'app/**/*.{ts,tsx}',
        'lib/**/*.{ts,tsx}',
        'components/**/*.{ts,tsx}',
        '!**/*.test.{ts,tsx}',
        '!**/*.d.ts',
        '!lib/types.ts',
    ],
    // CI gate: fail the build if coverage regresses below these floors.
    //
    // testability-3 (Regis 2026-06-22): com `collectCoverageFrom` acima, a cobertura
    // passou a medir TODO o código-fonte (não só os ~10 arquivos importados por testes).
    // O número antigo (~82%) era "Potemkin"; o baseline REAL é bem menor — a maior parte
    // do `app/` (ex.: `permutas/page.tsx`, 2127 LOC) e vários `components/` não têm teste.
    // Reassentado (2026-06-26, v0.8.0): a expansão da `permutas/page.tsx` (Histórico, botões de
    // Atualizar, Executar em lote etc. — UI sem teste de componente) DILUIU a % global. A LÓGICA PURA
    // nova vive em `lib/utils.ts` e TEM teste (ordenarPorEtapaPermuta, bucketEtapaPermuta,
    // ordenarBorderosPainel); o não-coberto é o JSX/handlers do componente gigante. Medido: global
    // ~20.7% lines / 9.59% branches / 14.85% functions. Floors JUST BELOW o real → CI verde, regressão
    // futura trava. SUBIR conforme testes de componente forem adicionados. './lib/auth/' é DIRETÓRIO.
    //
    // RATCHET (2026-09-03, card `testability-4`): medido hoje 35,11% lines / 25,02% branches /
    // 29,67% functions — o piso de 20/9/14 estava ~15 pontos ABAIXO do real e não travava
    // regressão nenhuma. Piso que só sobe quando alguém lembra não é gate, é decoração.
    // Reassentado logo abaixo do medido. Ao subir a cobertura, subir o piso junto.
    coverageThreshold: {
        global: {
            lines: 33,
            branches: 23,
            functions: 28,
        },
        './lib/auth/': {
            lines: 24,
        },
    },
    transform: {
        '^.+\\.(ts|tsx)$': [
            'ts-jest',
            {
                tsconfig: {
                    module: 'CommonJS',
                    moduleResolution: 'node',
                    esModuleInterop: true,
                    jsx: 'react-jsx',
                    target: 'ES2020',
                    lib: ['DOM', 'DOM.Iterable', 'ESNext'],
                },
            },
        ],
    },
};
