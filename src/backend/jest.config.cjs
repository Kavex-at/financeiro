/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    moduleFileExtensions: ['ts', 'js', 'json'],
    testMatch: ['<rootDir>/**/*.test.ts'],
    testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.test\\.ts$'],
    // Limit parallel workers to avoid OOM on Windows (default = CPU count - 1
    // hits 5+ workers and trips heap on ts-jest type-checks). 2 workers run
    // the suite faster than --runInBand without OOM.
    maxWorkers: 2,
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    // CI gate: fail the build if coverage regresses below these floors.
    //
    // Jest subtracts files matched by a path/glob key from the "global"
    // bucket and applies each key's thresholds independently. Because the
    // high-coverage domain/service files are pulled into their own (stricter)
    // key, the "global" floors below are measured against the REMAINING files
    // (clients, repositories, handlers, legacy services). Measured baseline
    // for that remaining bucket: ~74.16% lines, ~55.8% branches, ~79.14%
    // functions; for domain/service (aggregate): ~96.71% lines, ~79.33%
    // branches, ~95.28% functions. Floors are set just below current so this
    // PR stays green while any future regression trips CI.
    //
    // The './domain/service/' key is a DIRECTORY path (no glob), so jest
    // enforces it on the AGGREGATE of that directory, not file-by-file.
    //
    // BOOTSTRAP (2026-06-10): the fechamento service suite was pruned; only
    // `LogService` remains in domain/service until features add TDD'd services
    // via /feature-new. Floors recalibrated just below current LogService
    // coverage (~91% lines, ~64% branches). Re-tighten as the domain grows.
    //
    // Pisos POR ARQUIVO para o ciclo de vida de processo (card `testability-3`): pool, shutdown,
    // boot. São arquivos pequenos, novos e de alto risco, onde uma regressão de cobertura sumiria
    // no bucket global de ~52k linhas sem mover a agulha. Piso = medido hoje, arredondado para
    // baixo — é ratchet contra regressão, não meta a alcançar.
    coverageThreshold: {
        global: {
            lines: 72,
            branches: 54,
            functions: 78,
        },
        './domain/service/': {
            lines: 88,
            branches: 60,
        },
        './http/gracefulShutdown.ts': {
            lines: 95,
            branches: 85,
        },
        './http/bootstrap.ts': {
            lines: 95,
            branches: 90,
        },
        './http/lifecycle.ts': {
            lines: 95,
            branches: 90,
        },
        './http/lastResortHandlers.ts': {
            lines: 90,
            branches: 75,
        },
        './services/conexosSessionStore.ts': {
            lines: 88,
            branches: 70,
        },
    },
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                tsconfig: {
                    module: 'CommonJS',
                    moduleResolution: 'node',
                    esModuleInterop: true,
                    experimentalDecorators: true,
                    emitDecoratorMetadata: true,
                    useDefineForClassFields: false,
                },
            },
        ],
    },
};
