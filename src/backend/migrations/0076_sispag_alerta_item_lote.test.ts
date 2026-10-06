import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
    ITEM_ALERT_RESOLUTION,
    ITEM_ALERT_STATE,
    ITEM_ALERT_TYPE,
    PAYMENT_CHECK_STATE,
} from '../domain/interface/sispag/SispagInterface.js';
import { DESTINO_ORIGEM } from '../domain/service/sispag/DestinoPagamentoResolver.js';
import MigrationFiles from './MigrationFiles.js';

/**
 * 0076 — AlertaItemLote e estado da verificação no item (ADR-0063). Asserções sobre o FONTE (o
 * `MigrationRunner` usa `import.meta` e não roda sob Jest); o comportamento contra um Postgres de
 * verdade está em `0078_sispag_perfil_canal_conferencia.integration.test.ts`.
 */
const NOME = '0076_sispag_alerta_item_lote.sql';
const CODIGO = readFileSync(path.join(__dirname, NOME), 'utf8')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');

const valoresDoCheck = (nome: string): string[] => {
    const m = CODIGO.match(new RegExp(`${nome}[\\s\\S]*?IN \\(([^)]*)\\)`, 'i'));
    return [...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((v) => v[1] ?? '').sort();
};

describe('migration 0076 — alerta do item e estado da verificação (ADR-0063)', () => {
    it('os CHECKs batem com as constantes do código', () => {
        expect(valoresDoCheck('lote_pagamento_item_alerta_tipo_check')).toEqual(
            Object.values(ITEM_ALERT_TYPE).sort(),
        );
        expect(valoresDoCheck('lote_pagamento_item_alerta_estado_check')).toEqual(
            Object.values(ITEM_ALERT_STATE).sort(),
        );
        expect(valoresDoCheck('lote_pagamento_item_alerta_resolucao_check')).toEqual(
            Object.values(ITEM_ALERT_RESOLUTION).sort(),
        );
        expect(valoresDoCheck('lote_pagamento_item_verificacao_estado_check')).toEqual(
            Object.values(PAYMENT_CHECK_STATE).sort(),
        );
        expect(valoresDoCheck('lote_pagamento_item_destino_origem_check')).toEqual(
            Object.values(DESTINO_ORIGEM).sort(),
        );
    });

    it('uma alerta viva por (lote, item, tipo, contraparte) — chave da estabilidade (I13h)', () => {
        expect(CODIGO).toMatch(
            /CREATE UNIQUE INDEX IF NOT EXISTS ux_lote_pagamento_item_alerta_viva[\s\S]*?WHERE estado IN \('ABERTA', 'RESOLVIDA'\)/i,
        );
    });

    it('JUSTIFICADA exige texto; RESOLVIDA exige resolução e quem resolveu', () => {
        expect(CODIGO).toMatch(/length\(btrim\(justificativa\)\) > 0/i);
        expect(CODIGO).toMatch(
            /estado <> 'RESOLVIDA' OR \(resolucao IS NOT NULL AND resolvido_por/i,
        );
    });

    it('a alerta morre com o lote (CASCADE); só a máscara do destino é guardada', () => {
        expect(CODIGO).toMatch(/REFERENCES lote_pagamento\(id\) ON DELETE CASCADE/i);
        expect(CODIGO).toMatch(/destino_mascarado TEXT NULL/i);
        expect(CODIGO).not.toMatch(/conta\s+TEXT|chave_pix\s+TEXT/i);
    });

    it('idempotente e só cria (nada de DROP TABLE, DELETE ou UPDATE)', () => {
        for (const c of CODIGO.match(/CREATE (UNIQUE )?(TABLE|INDEX)[^\n]*/gi) ?? []) {
            expect(c).toMatch(/IF NOT EXISTS/i);
        }
        expect(CODIGO.match(/ADD COLUMN/gi)?.length).toBe(
            CODIGO.match(/ADD COLUMN IF NOT EXISTS/gi)?.length,
        );
        expect(CODIGO).not.toMatch(/DROP TABLE|DELETE FROM|UPDATE\s+\w+\s+SET/i);
    });

    it('é migração de verdade (copiada ao dist/) e única com o número 0076', () => {
        expect(new MigrationFiles().list(__dirname)).toContain(NOME);
        expect(readdirSync(__dirname).filter((f) => /^0076_.*\.sql$/.test(f))).toEqual([NOME]);
    });
});
