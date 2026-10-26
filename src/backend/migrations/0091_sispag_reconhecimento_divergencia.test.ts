import { readFileSync } from 'node:fs';
import path from 'node:path';
import { VINCULO_CAMINHO } from '../domain/interface/sispag/SispagInterface.js';

/**
 * 0091 — reconhecimento tipado e caminho do vínculo (ADR-0078). Asserções sobre o FONTE (padrão
 * 0084–0089: o `MigrationRunner` não roda sob Jest).
 */
const NOME = '0091_sispag_reconhecimento_divergencia.sql';
const SQL = readFileSync(path.join(__dirname, NOME), 'utf8');
const CODIGO = SQL.split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');

describe('migration 0091 — reconhecimento tipado da divergência de data (ADR-0078)', () => {
    it('é aditiva: só ADD COLUMN IF NOT EXISTS e CHECKs guardados; nenhum UPDATE/DELETE/DROP', () => {
        expect(CODIGO).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|DROP)\b/i);
        const colunas = CODIGO.match(/ADD COLUMN/g) ?? [];
        const guardadas = CODIGO.match(/ADD COLUMN IF NOT EXISTS/g) ?? [];
        expect(colunas.length).toBe(guardadas.length);
        expect(colunas.length).toBe(9);
        expect(CODIGO).not.toMatch(/NOT NULL,|NOT NULL;/);
    });

    it('as seis colunas do reconhecimento na decisão são nuláveis e tudo-ou-nada', () => {
        for (const c of [
            'reconhecimento_tipo TEXT NULL',
            'reconhecimento_motivo TEXT NULL',
            'reconhecimento_delta_dias_visto INTEGER NULL',
            'reconhecimento_valor_boleto_visto_centavos BIGINT NULL',
            'reconhecido_por TEXT NULL',
            'reconhecido_em TIMESTAMPTZ NULL',
        ]) {
            expect(CODIGO).toContain(c);
        }
        expect(CODIGO).toMatch(/reconhecimento_tudo_ou_nada_check/);
    });

    it('tipo só DATA_DIVERGENTE, motivo 10–500 e reconhecedor nunca "sistema"', () => {
        expect(CODIGO).toMatch(/reconhecimento_tipo IN \('DATA_DIVERGENTE'\)/);
        expect(CODIGO).toMatch(/length\(btrim\(reconhecimento_motivo\)\) BETWEEN 10 AND 500/);
        expect(CODIGO).toMatch(/lower\(btrim\(reconhecido_por\)\) NOT IN \('sistema'/);
    });

    it('o CHECK de caminho é exatamente o VINCULO_CAMINHO do código', () => {
        const m = CODIGO.match(/vinculo_caminho IN \(([^)]*)\)/);
        const valores = [...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
        expect(valores).toEqual(Object.values(VINCULO_CAMINHO).sort());
    });

    it('DATA_DIVERGENTE exige o reconhecimento; JANELA_PADRAO não o carrega', () => {
        expect(CODIGO).toMatch(
            /vinculo_caminho = 'DATA_DIVERGENTE'[\s\S]*?vinculo_reconhecimento_id IS NOT NULL/,
        );
        expect(CODIGO).toMatch(
            /vinculo_caminho = 'JANELA_PADRAO'[\s\S]*?vinculo_reconhecimento_id IS NULL/,
        );
    });

    it('não toca a trilha só-inclusão (nenhum tipo de evento novo)', () => {
        expect(CODIGO).not.toMatch(/sispag_sugestao_boleto_evento/);
    });
});
