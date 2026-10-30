import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FORNECEDOR_ORIGEM } from '../domain/interface/sispag/FornecedorContaBoleto.js';

/** 0093 — mapeamento conta → fornecedor (ADR-0081). Asserções sobre o FONTE (padrão 0084–0091). */
const NOME = '0093_sispag_fornecedor_conta_boleto.sql';
const SQL = readFileSync(path.join(__dirname, NOME), 'utf8');
const CODIGO = SQL.split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');

describe('migration 0093 — fornecedor do boleto pela conta do beneficiário (ADR-0081)', () => {
    it('é aditiva e idempotente: só CREATE TABLE IF NOT EXISTS', () => {
        expect(CODIGO).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|DROP|ALTER)\b/i);
        expect(CODIGO.match(/CREATE TABLE/g)).toHaveLength(1);
        expect(CODIGO).toContain('CREATE TABLE IF NOT EXISTS sispag_fornecedor_conta_boleto');
    });

    it('a chave é a PK e não há coluna de barras nem de linha digitável', () => {
        expect(CODIGO).toContain('chave                 TEXT PRIMARY KEY');
        expect(CODIGO).not.toMatch(/codbar|barras|linha_digitavel/i);
    });

    it('o CHECK de origem é exatamente o FORNECEDOR_ORIGEM do código', () => {
        const m = CODIGO.match(/origem IN \(([^)]*)\)/);
        const valores = [...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
        expect(valores).toEqual(Object.values(FORNECEDOR_ORIGEM).sort());
    });

    it('ambígua não nomeia; não ambígua sempre tem pes_cod', () => {
        expect(CODIGO).toMatch(/ambiguo AND pes_cod IS NULL AND credor IS NULL/);
        expect(CODIGO).toMatch(/NOT ambiguo AND pes_cod IS NOT NULL/);
    });

    it('o reverse existe e só derruba a tabela', () => {
        const rollback = readFileSync(
            path.join(__dirname, 'rollbacks', NOME.replace('.sql', '.rollback.sql')),
            'utf8',
        )
            .split('\n')
            .map((linha) => linha.replace(/--.*$/, ''))
            .join('\n')
            .trim();
        expect(rollback).toBe('DROP TABLE IF EXISTS sispag_fornecedor_conta_boleto;');
    });
});
