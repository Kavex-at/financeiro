import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * 0072 — índices (ator, tempo) do read model AtividadeUsuario (ADR-0058).
 *
 * Asserções sobre o FONTE, no padrão de `0071_app_user_auth_user_id.test.ts`: o `MigrationRunner`
 * usa `import.meta` e não roda sob Jest. A aplicação real (duas vezes, idempotência) roda no
 * `atividadeUsuario.integration.test.ts` (`npm run test:sql`, job `backend-sql` do CI).
 */
const SQL = readFileSync(path.join(__dirname, '0072_idx_atividade_usuario.sql'), 'utf8');
const REVERSE = readFileSync(
    path.join(__dirname, 'rollbacks', '0072_idx_atividade_usuario.rollback.sql'),
    'utf8',
);

/** O SQL sem comentários de linha — para que um `DROP` citado num comentário não conte. */
const semComentarios = (sql: string): string =>
    sql
        .split('\n')
        .map((linha) => linha.replace(/--.*$/, ''))
        .join('\n');
const CODIGO = semComentarios(SQL);

/** Cada `CREATE INDEX` do fonte: nome, tabela e o texto das colunas (inclui expressões). */
const INDICES = [
    ...CODIGO.matchAll(
        /CREATE INDEX IF NOT EXISTS (\w+)\s+ON (\w+) \(((?:[^()]|\([^()]*(?:\([^()]*\))?[^()]*\))*)\)/g,
    ),
].map((m) => ({ nome: m[1], tabela: m[2], colunas: m[3] }));

/** Migration(s) onde cada tabela e as colunas citadas nasceram. */
const ORIGEM: Record<string, string[]> = {
    permuta_alocacao_execucao: [
        '0015_permuta_alocacao_execucao.sql',
        '0065_metricas_ciclo_data_pelo_encerramento.sql',
    ],
    solicitacao_numerario_execucao: [
        '0041_solicitacao_numerario_execucao.sql',
        '0065_metricas_ciclo_data_pelo_encerramento.sql',
    ],
    remessa_execucao: ['0049_sispag_remessa_retorno.sql', '0070_metricas_ciclo_sispag.sql'],
    conciliacao_execucao: ['0050_conciliacao_execucao.sql'],
    lote_pagamento: ['0023_lote_pagamento.sql'],
    permuta_excecao_manual: ['0059_excecao_permuta.sql'],
    lote_pagamento_item_destino_audit: ['0067_sispag_destino_manual.sql'],
    alerta: ['0052_alerta.sql'],
    app_user_access_event: ['0066_auth_permissoes_modulo.sql'],
};

const ESPERADOS: Array<[string, string]> = [
    ['permuta_alocacao_execucao', 'executado_por, (COALESCE(encerrado_em, criado_em))'],
    ['solicitacao_numerario_execucao', 'executado_por, (COALESCE(encerrado_em, criado_em))'],
    ['remessa_execucao', 'executado_por, (COALESCE(encerrado_em, criado_em))'],
    ['conciliacao_execucao', 'executado_por, atualizado_em'],
    ['lote_pagamento', 'criado_por, criado_em'],
    ['lote_pagamento', 'finalizado_por, finalizado_em'],
    ['permuta_excecao_manual', 'criado_por, criado_em'],
    ['permuta_excecao_manual', 'removido_por, removido_em'],
    ['lote_pagamento_item_destino_audit', 'alterado_por, alterado_em'],
    ['alerta', 'reconhecido_por, reconhecido_em'],
    ['app_user_access_event', 'ator, em'],
];

describe('migration 0072 — índices (ator, tempo) da AtividadeUsuario', () => {
    it('é a próxima migration livre e não colide com outra 0072', () => {
        const mesmas = readdirSync(__dirname).filter((f) => /^0072_.*\.sql$/.test(f));
        expect(mesmas).toEqual(['0072_idx_atividade_usuario.sql']);
    });

    it('só CREATE INDEX IF NOT EXISTS: sem CONCURRENTLY, sem DDL de tabela, sem DROP, sem UPDATE', () => {
        expect(CODIGO).not.toMatch(/CONCURRENTLY/i);
        expect(CODIGO).not.toMatch(/\b(ALTER|DROP|UPDATE|DELETE|INSERT|TRUNCATE|GRANT)\b/i);
        expect(CODIGO).not.toMatch(/CREATE\s+(TABLE|UNIQUE|OR REPLACE|FUNCTION|VIEW)/i);
        const statements = CODIGO.split(';')
            .map((s) => s.trim())
            .filter(Boolean);
        for (const s of statements) {
            expect(s).toMatch(/^CREATE INDEX IF NOT EXISTS /);
        }
        expect(statements).toHaveLength(ESPERADOS.length);
    });

    it('o comentário do topo explica a ausência de CONCURRENTLY citando a 0048', () => {
        expect(SQL).toMatch(/Sem CONCURRENTLY/);
        expect(SQL).toMatch(/0048/);
    });

    it('cria exatamente os índices esperados (expressão onde a data é COALESCE)', () => {
        expect(INDICES.map((i) => [i.tabela, i.colunas])).toEqual(ESPERADOS);
    });

    it('parciais onde o ator é anulável', () => {
        for (const [tabela, coluna] of [
            ['lote_pagamento', 'finalizado_por'],
            ['permuta_excecao_manual', 'removido_por'],
            ['alerta', 'reconhecido_por'],
        ]) {
            expect(CODIGO).toMatch(
                new RegExp(`ON ${tabela} \\(${coluna}, \\w+\\)\\s+WHERE ${coluna} IS NOT NULL`),
            );
        }
    });

    it('toda coluna citada existe no fonte da migration de origem da tabela', () => {
        for (const indice of INDICES) {
            const origens = ORIGEM[indice.tabela];
            expect(origens).toBeDefined();
            const fonte = (origens ?? [])
                .map((f) => readFileSync(path.join(__dirname, f), 'utf8'))
                .join('\n');
            const colunas = indice.colunas.match(/[a-z_]+/g) ?? [];
            for (const coluna of colunas.filter((c) => c !== 'COALESCE'.toLowerCase())) {
                expect({ tabela: indice.tabela, coluna, existe: fonte.includes(coluna) }).toEqual({
                    tabela: indice.tabela,
                    coluna,
                    existe: true,
                });
            }
        }
    });

    it('o reverse dropa exatamente os índices criados, com IF EXISTS', () => {
        const dropados = [...semComentarios(REVERSE).matchAll(/DROP INDEX IF EXISTS (\w+);/g)].map(
            (m) => m[1],
        );
        expect(dropados.sort()).toEqual(INDICES.map((i) => i.nome).sort());
        expect(semComentarios(REVERSE)).not.toMatch(/DROP INDEX (?!IF EXISTS)/);
    });
});
