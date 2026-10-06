import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
    CHANNEL_CONFIDENCE,
    CHANNEL_GROUP,
    VERIFICATION_EVENT,
} from '../domain/interface/sispag/SispagInterface.js';
import MigrationFiles from './MigrationFiles.js';

/** 0078 — perfil de canal, conferência e trilha só-inclusão (ADR-0063). Asserções sobre o FONTE. */
const NOME = '0078_sispag_perfil_canal_conferencia.sql';
const CODIGO = readFileSync(path.join(__dirname, NOME), 'utf8')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');

const valoresDoCheck = (nome: string): string[] => {
    const m = CODIGO.match(new RegExp(`${nome}[\\s\\S]*?IN \\(([^)]*)\\)`, 'i'));
    return [...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((v) => v[1] ?? '').sort();
};

describe('migration 0078 — perfil de canal, conferência e trilha (ADR-0063)', () => {
    it('os CHECKs batem com as constantes do código (evento novo sem migration falha)', () => {
        expect(valoresDoCheck('perfil_canal_fornecedor_grupo_check')).toEqual(
            Object.values(CHANNEL_GROUP).sort(),
        );
        expect(valoresDoCheck('perfil_canal_fornecedor_confianca_check')).toEqual(
            Object.values(CHANNEL_CONFIDENCE).sort(),
        );
        expect(valoresDoCheck('sispag_verificacao_evento_evento_check')).toEqual(
            Object.values(VERIFICATION_EVENT).sort(),
        );
    });

    it('um perfil por favorecido (pes_cod é a chave, gap Q4)', () => {
        expect(CODIGO).toMatch(/pes_cod\s+TEXT PRIMARY KEY/i);
        expect(CODIGO).toMatch(/job_run_id\s+TEXT NOT NULL/i);
    });

    it('conferência é atributo do lote, sem status novo', () => {
        for (const coluna of [
            'conferido_por',
            'conferido_em',
            'devolvido_por',
            'devolvido_em',
            'motivo_devolucao',
        ]) {
            expect(CODIGO).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${coluna}`, 'i'));
        }
        expect(CODIGO).not.toMatch(/status_check|'CONFERIDO'/i);
    });

    it('a trilha é só-inclusão: trigger recusa UPDATE, DELETE e TRUNCATE', () => {
        expect(CODIGO).toMatch(/BEFORE UPDATE OR DELETE ON sispag_verificacao_evento/i);
        expect(CODIGO).toMatch(/BEFORE TRUNCATE ON sispag_verificacao_evento/i);
        expect(CODIGO).toMatch(/RAISE EXCEPTION/i);
        expect(CODIGO).toMatch(/CREATE OR REPLACE FUNCTION sispag_verificacao_evento_so_inclusao/i);
    });

    it('idempotente e só cria', () => {
        for (const c of CODIGO.match(/CREATE (UNIQUE )?(TABLE|INDEX)[^\n]*/gi) ?? []) {
            expect(c).toMatch(/IF NOT EXISTS/i);
        }
        expect(CODIGO).toMatch(
            /DROP TRIGGER IF EXISTS trg_sispag_verificacao_evento_so_inclusao ON/i,
        );
        expect(CODIGO).not.toMatch(/DROP TABLE|DELETE FROM|UPDATE\s+\w+\s+SET/i);
    });

    it('é migração de verdade (copiada ao dist/) e única com o número 0078', () => {
        expect(new MigrationFiles().list(__dirname)).toContain(NOME);
        expect(readdirSync(__dirname).filter((f) => /^0078_.*\.sql$/.test(f))).toEqual([NOME]);
    });
});
