import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ALERTA_TIPO } from '../domain/interface/operacao/Alerta.js';
import {
    BAIXA_FONTE,
    ITEM_SITUACAO,
    ORIGEM_BAIXA,
} from '../domain/interface/sispag/SispagInterface.js';
import MigrationFiles from './MigrationFiles.js';

/**
 * 0069 — situação do item e trilha da baixa observada (ADR-0055, I11).
 *
 * Asserções sobre o FONTE (padrão da 0064/0066/0067/0068: o `MigrationRunner` usa `import.meta` e
 * não roda sob Jest).
 */
const NOME = '0069_sispag_item_situacao_sincronizacao.sql';
const SQL = readFileSync(path.join(__dirname, NOME), 'utf8');

const semComentarios = (texto: string): string =>
    texto
        .split('\n')
        .map((linha) => linha.replace(/--.*$/, ''))
        .join('\n');

const CODIGO = semComentarios(SQL);

const valoresDoCheck = (constraint: string, coluna: string): string[] => {
    const re = new RegExp(
        `ADD CONSTRAINT ${constraint}\\s+CHECK\\s*\\(\\s*${coluna}\\s+IN\\s*\\(([^)]*)\\)\\s*\\)`,
        'i',
    );
    const m = CODIGO.match(re);
    if (!m) return [];
    return [...m[1].matchAll(/'([^']+)'/g)].map((v) => v[1]).sort();
};

describe('migration 0069 — situação do item do lote SISPAG (ADR-0055)', () => {
    it('acrescenta EXATAMENTE as colunas da entidade, idempotente', () => {
        const colunas = [...CODIGO.matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)/gi)].map((m) => m[1]);
        expect(colunas.sort()).toEqual(
            [
                'situacao',
                'pago_em',
                'pago_observado_em',
                'valor_pago',
                'origem_baixa',
                'baixa_fonte',
                'divergencia',
                'divergencia_detalhe',
                'sincronizado_em',
            ].sort(),
        );
        expect(CODIGO).toMatch(/divergencia\s+BOOLEAN NOT NULL DEFAULT FALSE/i);
        expect(CODIGO).not.toMatch(/ADD COLUMN(?! IF NOT EXISTS)/i);
    });

    it('os CHECK repetem as constantes tipadas do código (paridade)', () => {
        expect(valoresDoCheck('lote_pagamento_item_situacao_check', 'situacao')).toEqual(
            Object.values(ITEM_SITUACAO).sort(),
        );
        expect(valoresDoCheck('lote_pagamento_item_origem_baixa_check', 'origem_baixa')).toEqual(
            Object.values(ORIGEM_BAIXA).sort(),
        );
        expect(valoresDoCheck('lote_pagamento_item_baixa_fonte_check', 'baixa_fonte')).toEqual(
            Object.values(BAIXA_FONTE).sort(),
        );
    });

    it('cada constraint é derrubada antes de ser recriada (reaplicável)', () => {
        for (const nome of [
            'lote_pagamento_item_situacao_check',
            'lote_pagamento_item_origem_baixa_check',
            'lote_pagamento_item_baixa_fonte_check',
            'alerta_tipo_check',
        ]) {
            const drop = CODIGO.search(new RegExp(`DROP CONSTRAINT IF EXISTS ${nome}`, 'i'));
            const add = CODIGO.search(new RegExp(`ADD CONSTRAINT ${nome}`, 'i'));
            expect(drop).toBeGreaterThan(-1);
            expect(add).toBeGreaterThan(drop);
        }
    });

    it('o CHECK de alerta.tipo é o catálogo ALERTA_TIPO do dia da 0069 (a 0075 acrescentou um tipo)', () => {
        // A paridade com o catálogo ATUAL é checada no teste da 0075; a 0069 é histórico.
        expect(valoresDoCheck('alerta_tipo_check', 'tipo')).toEqual(
            Object.values(ALERTA_TIPO)
                .filter((t) => t !== 'sispag-excecao-divergencia')
                .sort(),
        );
    });

    it('é uma migração de verdade: listada pelo MigrationFiles (e portanto copiada ao dist/)', () => {
        expect(new MigrationFiles().list(__dirname)).toContain(NOME);
    });

    it('o reverse existe em rollbacks/ e não no nível de cima', () => {
        expect(readdirSync(path.join(__dirname, 'rollbacks'))).toContain(
            '0069_sispag_item_situacao_sincronizacao.rollback.sql',
        );
        expect(readdirSync(__dirname)).not.toContain(
            '0069_sispag_item_situacao_sincronizacao.rollback.sql',
        );
    });
});
