import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ALERTA_TIPO } from '../domain/interface/operacao/Alerta.js';
import {
    GRUPO_BOLETO_ESTADO,
    GRUPO_BOLETO_EVENTO,
    GRUPO_BOLETO_ORIGEM,
    GRUPO_BOLETO_TIPO_ANULACAO,
} from '../domain/interface/sispag/GrupoBoletoInterface.js';
import { DUPLICATE_HOLD_ORIGIN } from '../domain/interface/sispag/SispagInterface.js';
import EtapaBorderoGrupo from '../domain/libs/boleto/EtapaBorderoGrupo.js';
import MigrationFiles from './MigrationFiles.js';

/**
 * 0090 — boleto agrupado (ADR-0076, I19). Asserções sobre o FONTE (padrão 0084–0088: o
 * `MigrationRunner` usa `import.meta` e não roda sob Jest). O comportamento contra um Postgres de
 * verdade está em `0090_sispag_grupo_boleto.integration.test.ts`.
 */
const NOME = '0090_sispag_grupo_boleto.sql';
const SQL = readFileSync(path.join(__dirname, NOME), 'utf8');
const CODIGO = SQL.split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');

const valoresDe = (re: RegExp): string[] => {
    const m = CODIGO.match(re);
    expect(m).not.toBeNull();
    return [...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1] as string).sort();
};

const ordenado = (o: Record<string, string>): string[] => Object.values(o).sort();

describe('migration 0090 — boleto agrupado (ADR-0076)', () => {
    it('estado e origem do grupo são as constantes tipadas', () => {
        expect(
            valoresDe(/sispag_grupo_boleto_estado_check CHECK \(\s*estado IN \(([^)]*)\)/),
        ).toEqual(ordenado(GRUPO_BOLETO_ESTADO));
        expect(
            valoresDe(/sispag_grupo_boleto_titulo_estado_check CHECK \(\s*estado IN \(([^)]*)\)/),
        ).toEqual(ordenado(GRUPO_BOLETO_ESTADO));
        expect(
            valoresDe(/sispag_grupo_boleto_origem_check CHECK \(\s*origem IN \(([^)]*)\)/),
        ).toEqual(ordenado(GRUPO_BOLETO_ORIGEM));
        expect(valoresDe(/tipo_anulacao IN \(([^)]*)\)/)).toEqual(
            ordenado(GRUPO_BOLETO_TIPO_ANULACAO),
        );
    });

    it('o CHECK de etapa da execução é exatamente a máquina da Task 4 (EtapaBorderoGrupo)', () => {
        expect(
            valoresDe(/sispag_grupo_boleto_execucao_etapa_check CHECK \(\s*etapa IN \(([^)]*)\)/),
        ).toEqual(EtapaBorderoGrupo.todas().sort());
    });

    it('"uma execução não terminal por grupo" usa exatamente os terminais da máquina', () => {
        const terminais = EtapaBorderoGrupo.todas()
            .filter((e) => EtapaBorderoGrupo.ehTerminal(e))
            .sort();
        expect(
            valoresDe(
                /ux_sispag_grupo_boleto_execucao_nao_terminal\s+ON sispag_grupo_boleto_execucao \(grupo_id\)\s+WHERE etapa NOT IN \(([^)]*)\)/,
            ),
        ).toEqual(terminais);
    });

    it('identidade do borderô = fil_cod + bor_cod + bor_tim_cad (epoch ms); sem coluna de marcador', () => {
        expect(CODIGO).toMatch(/bor_cod\s+INTEGER NULL/);
        expect(CODIGO).toMatch(/bor_tim_cad\s+BIGINT NULL/);
        expect(CODIGO).toMatch(/\(bor_cod IS NULL\) = \(bor_tim_cad IS NULL\)/);
        expect(CODIGO).not.toMatch(/^\s*marcador\s+\w+/im);
        expect(CODIGO).not.toMatch(/bor_esp_nrbanco/i);
    });

    it('write-ahead: t0 antes do POST, t1 depois e NULO (o processo pode morrer antes de gravá-lo)', () => {
        expect(CODIGO).toMatch(/escrita_iniciada_em\s+TIMESTAMPTZ NULL/);
        expect(CODIGO).toMatch(/escrita_concluida_em\s+TIMESTAMPTZ NULL/);
        expect(CODIGO).toMatch(/usn_cod_cad\s+INTEGER NULL/);
    });

    it('identidade Conexos no ledger (I-2) e máscara 5+4 no esquema', () => {
        expect(CODIGO).toMatch(/conexos_username\s+TEXT NULL/);
        expect(CODIGO).toMatch(/conexos_usn_cod\s+TEXT NULL/);
        const mascaras = CODIGO.match(/~ '\^\[0-9\]\{5\}…\[0-9\]\{4\}\$'/g) ?? [];
        expect(mascaras.length).toBeGreaterThanOrEqual(2); // grupo e evento
    });

    it('índices únicos parciais da I19i (boleto e título, WHERE estado = CONFIRMADO)', () => {
        expect(CODIGO).toMatch(
            /CREATE UNIQUE INDEX IF NOT EXISTS ux_sispag_grupo_boleto_confirmado_boleto\s+ON sispag_grupo_boleto \(ddc_cod, dit_cod\)\s+WHERE estado = 'CONFIRMADO'/,
        );
        expect(CODIGO).toMatch(
            /CREATE UNIQUE INDEX IF NOT EXISTS ux_sispag_grupo_boleto_titulo_confirmado\s+ON sispag_grupo_boleto_titulo \(fil_cod, doc_cod, tit_cod\)\s+WHERE estado = 'CONFIRMADO'/,
        );
    });

    it('trilha do grupo: tipos = GRUPO_BOLETO_EVENTO; UPDATE/DELETE/TRUNCATE recusados por trigger', () => {
        expect(
            valoresDe(/sispag_grupo_boleto_evento_tipo_check CHECK \(\s*tipo IN \(([^)]*)\)/),
        ).toEqual(ordenado(GRUPO_BOLETO_EVENTO));
        expect(CODIGO).toMatch(/BEFORE UPDATE OR DELETE ON sispag_grupo_boleto_evento/);
        expect(CODIGO).toMatch(/BEFORE TRUNCATE ON sispag_grupo_boleto_evento/);
    });

    it('lote_pagamento_item ganha grupo_boleto_id; remessa_execucao aceita preparar_bordero', () => {
        expect(CODIGO).toMatch(
            /ALTER TABLE lote_pagamento_item\s+ADD COLUMN IF NOT EXISTS grupo_boleto_id UUID NULL/,
        );
        expect(valoresDe(/remessa_execucao_etapa_check CHECK \(\s*etapa IN \(([^)]*)\)/)).toEqual(
            [
                'criar_lote',
                'preparar_bordero',
                'importar',
                'finalizar',
                'gerar_remessa',
                'concluido',
            ].sort(),
        );
    });

    it('origem GRUPO_BOLETO e alerta novo (paridade com DUPLICATE_HOLD_ORIGIN e ALERTA_TIPO)', () => {
        expect(
            valoresDe(/titulo_bloqueio_duplicidade_origem_check CHECK \(\s*origem IN \(([^)]*)\)/),
        ).toEqual(ordenado(DUPLICATE_HOLD_ORIGIN));
        expect(
            valoresDe(/ADD CONSTRAINT alerta_tipo_check\s+CHECK \(tipo IN \(([^)]*)\)\)/i),
        ).toEqual(ordenado(ALERTA_TIPO));
        expect(CODIGO).toMatch(/ALTER TABLE alerta DROP CONSTRAINT IF EXISTS alerta_tipo_check;/);
    });

    it('sem backfill: nenhuma linha existente muda', () => {
        expect(CODIGO).not.toMatch(
            /\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b|\bINSERT\s+INTO\b|\bDROP\s+(TABLE|COLUMN)\b/i,
        );
    });

    it('o .sql é copiado para dist/ pela mesma definição de migração do runner (incidente 2026-09-23)', () => {
        const listadas = new MigrationFiles().listOrFail(__dirname);
        expect(listadas).toContain(NOME);
        expect(listadas.filter((f) => f.startsWith('0090_'))).toEqual([NOME]);
    });

    it('tem reverse fora do alcance do runner', () => {
        const reverses = readdirSync(path.join(__dirname, 'rollbacks'));
        expect(reverses).toContain('0090_sispag_grupo_boleto.rollback.sql');
        expect(readdirSync(__dirname).filter((f) => f.endsWith('.rollback.sql'))).toEqual([]);
        const rollback = readFileSync(
            path.join(__dirname, 'rollbacks', '0090_sispag_grupo_boleto.rollback.sql'),
            'utf8',
        );
        expect(rollback).toMatch(/DELETE FROM alerta WHERE tipo = 'sispag-bordero-grupo-pendente'/);
    });
});
