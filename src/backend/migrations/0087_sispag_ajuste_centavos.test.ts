import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ALERTA_TIPO } from '../domain/interface/operacao/Alerta.js';
import { VERIFICATION_EVENT } from '../domain/interface/sispag/SispagInterface.js';
import { ETAPA_AJUSTE } from '../domain/libs/boleto/EtapaAjusteCentavos.js';
import MigrationFiles from './MigrationFiles.js';

/**
 * 0087 — ajuste de centavos do título (ADR-0073, I18). Asserções sobre o FONTE (padrão 0084–0086:
 * o `MigrationRunner` usa `import.meta` e não roda sob Jest). O comportamento contra um Postgres
 * de verdade está em `0087_sispag_ajuste_centavos.integration.test.ts`.
 */
const NOME = '0087_sispag_ajuste_centavos.sql';
const SQL = readFileSync(path.join(__dirname, NOME), 'utf8');
const CODIGO = SQL.split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');

const valoresDe = (re: RegExp): string[] => {
    const m = CODIGO.match(re);
    expect(m).not.toBeNull();
    return [...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1] as string).sort();
};

describe('migration 0087 — ajuste de centavos do título (ADR-0073)', () => {
    it('o CHECK de etapa do ledger é exatamente a máquina da I18h (EtapaAjusteCentavos)', () => {
        expect(valoresDe(/execucao_etapa_check CHECK \(etapa IN \(([^)]*)\)/)).toEqual(
            Object.values(ETAPA_AJUSTE).sort(),
        );
    });

    it('chave de idempotência e no máximo um não terminal por título de origem', () => {
        expect(CODIGO).toMatch(
            /ux_sispag_ajuste_centavos_execucao_idempotencia UNIQUE \(\s*fil_cod, doc_cod, tit_cod_origem, decisao_id\s*\)/,
        );
        expect(CODIGO).toMatch(
            /CREATE UNIQUE INDEX IF NOT EXISTS ux_sispag_ajuste_centavos_execucao_nao_terminal\s+ON sispag_ajuste_centavos_execucao \(fil_cod, doc_cod, tit_cod_origem\)\s+WHERE etapa NOT IN/,
        );
    });

    it('identidade Conexos no ledger (I-2) e máscara 5+4 no esquema', () => {
        expect(CODIGO).toMatch(/conexos_username\s+TEXT NULL/);
        expect(CODIGO).toMatch(/conexos_usn_cod\s+TEXT NULL/);
        expect(CODIGO).toMatch(
            /codigo_mascarado IS NULL OR codigo_mascarado ~ '\^\[0-9\]\{5\}…\[0-9\]\{4\}\$'/,
        );
    });

    it('decisão ganha tipo_anulacao, origem_decisao_id e transferida_por (sem backfill)', () => {
        expect(CODIGO).toMatch(/ADD COLUMN IF NOT EXISTS tipo_anulacao TEXT NULL/);
        expect(CODIGO).toMatch(/ADD COLUMN IF NOT EXISTS origem_decisao_id UUID NULL/);
        expect(CODIGO).toMatch(/ADD COLUMN IF NOT EXISTS transferida_por TEXT NULL/);
        expect(valoresDe(/tipo_anulacao IN \(([^)]*)\)/)).toEqual([
            'MANUAL',
            'PAR_REVOGADO',
            'TITULO_RENEGOCIADO',
        ]);
        expect(CODIGO).not.toMatch(
            /\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b|\bINSERT\s+INTO\b|\bTRUNCATE\b|\bDROP\s+(TABLE|COLUMN)\b/i,
        );
    });

    it('anulador_check: sistema SÓ com TITULO_RENEGOCIADO; unknown segue proibido; ator_check intacto', () => {
        expect(CODIGO).toMatch(/lower\(btrim\(anulada_por\)\) <> 'unknown'/);
        expect(CODIGO).toMatch(
            /lower\(btrim\(anulada_por\)\) <> 'sistema'\s+OR tipo_anulacao IS NOT DISTINCT FROM 'TITULO_RENEGOCIADO'/,
        );
        expect(CODIGO).not.toMatch(/ator_check/);
    });

    it('a trilha aceita os 6 tipos novos e mantém os 9 atuais; só-inclusão intacta', () => {
        expect(valoresDe(/evento_tipo_check CHECK \(tipo IN \(([^)]*)\)/)).toEqual(
            [
                'PAR_CONFIRMADO',
                'DECISAO_CONFIRMADA',
                'DECISAO_REJEITADA',
                'DECISAO_ANULADA',
                'PAR_REVOGADO',
                'LINHA_COPIADA',
                'VINCULO_APLICADO',
                'VINCULO_SIMULADO',
                'VINCULO_FALHOU',
                'AJUSTE_SIMULADO',
                'TITULO_RENEGOCIADO',
                'DECISAO_TRANSFERIDA',
                'AJUSTE_RECUSADO',
                'AJUSTE_CANCELADO',
                'AJUSTE_FALHOU',
            ].sort(),
        );
        expect(CODIGO).not.toMatch(/TRIGGER|so_inclusao/i);
    });

    it('a trilha do lote ganha ITEM_TITULO_RENEGOCIADO e mantém os 15 eventos da 0078', () => {
        const valores = valoresDe(/verificacao_evento_evento_check CHECK \(evento IN \(([^)]*)\)/);
        expect(valores).toEqual(Object.values(VERIFICATION_EVENT).sort());
    });

    it('alerta_tipo_check ganha sispag-ajuste-centavos-parado (paridade com ALERTA_TIPO), idempotente', () => {
        const valores = valoresDe(
            /ADD CONSTRAINT alerta_tipo_check\s+CHECK \(tipo IN \(([^)]*)\)\)/i,
        );
        expect(valores).toEqual(Object.values(ALERTA_TIPO).sort());
        expect(valores).toContain('sispag-ajuste-centavos-parado');
        expect(CODIGO).toMatch(/ALTER TABLE alerta DROP CONSTRAINT IF EXISTS alerta_tipo_check;/);
        const rollback = readFileSync(
            path.join(__dirname, 'rollbacks', '0087_sispag_ajuste_centavos.rollback.sql'),
            'utf8',
        );
        expect(rollback).toMatch(/DELETE FROM alerta WHERE tipo = 'sispag-ajuste-centavos-parado'/);
    });

    it('o .sql é copiado para dist/ pela mesma definição de migração do runner (incidente 2026-09-23)', () => {
        const listadas = new MigrationFiles().listOrFail(__dirname);
        expect(listadas).toContain(NOME);
        expect(listadas.filter((f) => f.startsWith('0087_'))).toEqual([NOME]);
    });

    it('tem reverse fora do alcance do runner', () => {
        const reverses = readdirSync(path.join(__dirname, 'rollbacks'));
        expect(reverses).toContain('0087_sispag_ajuste_centavos.rollback.sql');
        expect(readdirSync(__dirname).filter((f) => f.endsWith('.rollback.sql'))).toEqual([]);
    });
});
