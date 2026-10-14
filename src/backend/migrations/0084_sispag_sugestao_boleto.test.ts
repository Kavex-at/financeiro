import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PERMISSION_CATALOG } from '../domain/interface/auth/Permission.js';
import MigrationFiles from './MigrationFiles.js';

/**
 * 0084 — sugestão de boleto DDA (ADR-0068, I15). Asserções sobre o FONTE (padrão da 0080/0083: o
 * `MigrationRunner` usa `import.meta` e não roda sob Jest). O comportamento contra um Postgres de
 * verdade está em `0084_sispag_sugestao_boleto.integration.test.ts`.
 */
const NOME = '0084_sispag_sugestao_boleto.sql';
const SQL = readFileSync(path.join(__dirname, NOME), 'utf8');

const CODIGO = SQL.split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');

const valores = (trecho: string | undefined): string[] =>
    [...(trecho ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '').sort();

const checkIn = (nome: string): string[] => {
    const m = CODIGO.match(
        new RegExp(`${nome}\\s+CHECK \\(\\s*\\w+(?: IS NULL OR \\w+)? IN \\(([^)]*)\\)`, 'i'),
    );
    expect(m).not.toBeNull();
    return valores(m?.[1]);
};

describe('migration 0084 — sugestão de boleto DDA (ADR-0068)', () => {
    it('cria as três tabelas, aditiva e idempotente', () => {
        for (const t of [
            'sispag_confirmacao_emissor_boleto',
            'sispag_decisao_sugestao_boleto',
            'sispag_sugestao_boleto_evento',
        ]) {
            expect(CODIGO).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\s*\\(`, 'i'));
        }
        const criaIndice = CODIGO.match(/CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF NOT EXISTS)/gi);
        expect(criaIndice).toBeNull();
        expect(CODIGO).toMatch(/DROP TRIGGER IF EXISTS/i);
    });

    it('não toca dado existente nem o catálogo de permissões', () => {
        expect(CODIGO).not.toMatch(
            /\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b|\bINSERT\s+INTO\b|\bTRUNCATE\s+TABLE\b/i,
        );
        expect(CODIGO).not.toMatch(/app_role_permission|user_permission/i);
        // Nenhuma permissão nova: o catálogo continua o de antes (ADR-0053).
        expect(PERMISSION_CATALOG.map(String)).toEqual(
            expect.arrayContaining(['sispag:ver', 'sispag:executar']),
        );
    });

    it('os CHECK de layout, estado, tier, decisão e tipo têm os valores da ontologia', () => {
        expect(checkIn('sispag_confirmacao_emissor_boleto_layout_check')).toEqual(
            ['BRADESCO_237', 'GENERICO', 'ITAU_341'].sort(),
        );
        expect(checkIn('sispag_confirmacao_emissor_boleto_estado_check')).toEqual([
            'REVOGADA',
            'VIGENTE',
        ]);
        expect(checkIn('sispag_decisao_sugestao_boleto_tier_check')).toEqual(
            ['ATENCAO', 'CONHECIDO', 'FORTE'].sort(),
        );
        expect(checkIn('sispag_decisao_sugestao_boleto_decisao_check')).toEqual([
            'CONFIRMADA',
            'REJEITADA',
        ]);
        expect(checkIn('sispag_sugestao_boleto_evento_tipo_check')).toEqual(
            [
                'DECISAO_CONFIRMADA',
                'DECISAO_REJEITADA',
                'LINHA_COPIADA',
                'PAR_CONFIRMADO',
                'PAR_REVOGADO',
            ].sort(),
        );
    });

    it('no máximo um par VIGENTE por (pes_cod, emissor_chave) — índice único parcial', () => {
        expect(CODIGO).toMatch(
            /CREATE UNIQUE INDEX IF NOT EXISTS \w+\s+ON sispag_confirmacao_emissor_boleto \(pes_cod, emissor_chave\)\s+WHERE estado = 'VIGENTE'/i,
        );
    });

    it('REVOGADA exige motivo, quem e quando; ninguém confirma como `sistema`', () => {
        expect(CODIGO).toMatch(
            /estado <> 'REVOGADA'\s+OR \(\s*motivo_revogacao IS NOT NULL AND length\(btrim\(motivo_revogacao\)\) > 0\s+AND revogado_por IS NOT NULL\s+AND revogado_em IS NOT NULL/i,
        );
        expect(CODIGO).toMatch(/lower\(btrim\(confirmado_por\)\) <> 'sistema'/i);
        expect(CODIGO).toMatch(/confirmado_por\s+TEXT NOT NULL/i);
    });

    it('pes_cod em branco é recusado nas tabelas de par e de decisão', () => {
        for (const t of ['sispag_confirmacao_emissor_boleto', 'sispag_decisao_sugestao_boleto']) {
            expect(CODIGO).toMatch(
                new RegExp(
                    `${t}_pes_cod_check CHECK \\(\\s*length\\(btrim\\(pes_cod\\)\\) > 0`,
                    'i',
                ),
            );
        }
    });

    it('REJEITADA exige motivo; CONFIRMADA exige par e tier', () => {
        expect(CODIGO).toMatch(
            /decisao <> 'REJEITADA' OR \(motivo IS NOT NULL AND length\(btrim\(motivo\)\) > 0\)/i,
        );
        expect(CODIGO).toMatch(
            /decisao <> 'CONFIRMADA' OR \(confirmacao_emissor_id IS NOT NULL AND tier IS NOT NULL\)/i,
        );
        expect(CODIGO).toMatch(
            /confirmacao_emissor_id\s+UUID NULL REFERENCES sispag_confirmacao_emissor_boleto \(id\)/i,
        );
    });

    it('índices únicos parciais da decisão: 1 CONFIRMADA por título, 1 por boleto, 1 REJEITADA por par', () => {
        expect(CODIGO).toMatch(
            /ON sispag_decisao_sugestao_boleto \(fil_cod, doc_cod, tit_cod\)\s+WHERE decisao = 'CONFIRMADA'/i,
        );
        expect(CODIGO).toMatch(
            /ON sispag_decisao_sugestao_boleto \(ddc_cod, dit_cod\)\s+WHERE decisao = 'CONFIRMADA'/i,
        );
        expect(CODIGO).toMatch(
            /ON sispag_decisao_sugestao_boleto \(fil_cod, doc_cod, tit_cod, ddc_cod, dit_cod\)\s+WHERE decisao = 'REJEITADA'/i,
        );
    });

    it('a trilha recusa UPDATE, DELETE e TRUNCATE por trigger', () => {
        expect(CODIGO).toMatch(/BEFORE UPDATE OR DELETE ON sispag_sugestao_boleto_evento/i);
        expect(CODIGO).toMatch(/BEFORE TRUNCATE ON sispag_sugestao_boleto_evento/i);
        expect(CODIGO).toMatch(/ator\s+TEXT NOT NULL/i);
    });

    it('nenhuma coluna guarda a linha digitável nem as barras completas (I15k)', () => {
        expect(CODIGO).not.toMatch(/\b(codbar|linha_digitavel|codigo_barras)\s+TEXT/i);
        expect(CODIGO).toMatch(/codbar_mascarado\s+TEXT NOT NULL/i);
    });

    it('o .sql é copiado para dist/ pela mesma definição de migração do runner', () => {
        const listadas = new MigrationFiles().listOrFail(__dirname);
        expect(listadas).toContain(NOME);
        expect(listadas.filter((f) => f.startsWith('0084_'))).toEqual([NOME]);
    });

    it('tem reverse fora do alcance do runner e nenhuma outra migration 0084', () => {
        const reverses = readdirSync(path.join(__dirname, 'rollbacks'));
        expect(reverses).toContain('0084_sispag_sugestao_boleto.rollback.sql');
        expect(readdirSync(__dirname).filter((f) => f.endsWith('.rollback.sql'))).toEqual([]);
    });
});
