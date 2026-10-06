import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
    DESTINO_MANUAL_TIPO,
    DUPLICATE_HOLD_STATE,
    PAYEE_ISSUE_OUTCOME,
    PAYEE_ISSUE_STATE,
} from '../domain/interface/sispag/SispagInterface.js';
import MigrationFiles from './MigrationFiles.js';

/** 0077 — BloqueioDuplicidade e PendenciaCadastro (ADR-0063, I13g/I13k). Asserções sobre o FONTE. */
const NOME = '0077_sispag_bloqueio_pendencia.sql';
const CODIGO = readFileSync(path.join(__dirname, NOME), 'utf8')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');

const valoresDoCheck = (nome: string): string[] => {
    const m = CODIGO.match(new RegExp(`${nome}[\\s\\S]*?IN \\(([^)]*)\\)`, 'i'));
    return [...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((v) => v[1] ?? '').sort();
};

describe('migration 0077 — bloqueio por duplicidade e pendência de cadastro (ADR-0063)', () => {
    it('os CHECKs batem com as constantes do código', () => {
        expect(valoresDoCheck('titulo_bloqueio_duplicidade_estado_check')).toEqual(
            Object.values(DUPLICATE_HOLD_STATE).sort(),
        );
        expect(valoresDoCheck('pendencia_cadastro_estado_check')).toEqual(
            Object.values(PAYEE_ISSUE_STATE).sort(),
        );
        expect(valoresDoCheck('pendencia_cadastro_tipo_check')).toEqual(
            Object.values(DESTINO_MANUAL_TIPO).sort(),
        );
        expect(valoresDoCheck('pendencia_cadastro_origem_desfecho_check')).toEqual(
            Object.values(PAYEE_ISSUE_OUTCOME).sort(),
        );
    });

    it('no máximo um bloqueio ATIVO por título (I13g)', () => {
        expect(CODIGO).toMatch(
            /CREATE UNIQUE INDEX IF NOT EXISTS ux_titulo_bloqueio_duplicidade_ativo\s+ON titulo_bloqueio_duplicidade \(fil_cod, doc_cod, tit_cod\)\s+WHERE estado = 'ATIVO'/i,
        );
    });

    it('no máximo uma pendência ABERTA por (favorecido, tipo) (I13k)', () => {
        expect(CODIGO).toMatch(
            /CREATE UNIQUE INDEX IF NOT EXISTS ux_pendencia_cadastro_aberta\s+ON pendencia_cadastro \(pes_cod, tipo\)\s+WHERE estado = 'ABERTA'/i,
        );
    });

    it('desfazer exige quem e motivo; a pendência nunca guarda conta nem chave (I10h)', () => {
        expect(CODIGO).toMatch(/estado <> 'DESFEITO'[\s\S]*?motivo_desfazer IS NOT NULL/i);
        expect(CODIGO).not.toMatch(/\bconta\s+TEXT|chave_pix\s+TEXT|agencia/i);
    });

    it('idempotente e só cria', () => {
        for (const c of CODIGO.match(/CREATE (UNIQUE )?(TABLE|INDEX)[^\n]*/gi) ?? []) {
            expect(c).toMatch(/IF NOT EXISTS/i);
        }
        expect(CODIGO).not.toMatch(/DROP TABLE|DELETE FROM|UPDATE\s+\w+\s+SET/i);
    });

    it('é migração de verdade (copiada ao dist/) e única com o número 0077', () => {
        expect(new MigrationFiles().list(__dirname)).toContain(NOME);
        expect(readdirSync(__dirname).filter((f) => /^0077_.*\.sql$/.test(f))).toEqual([NOME]);
    });
});
