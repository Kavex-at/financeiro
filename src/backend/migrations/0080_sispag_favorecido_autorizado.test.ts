import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ALERTA_TIPO } from '../domain/interface/operacao/Alerta.js';
import { PERMISSION, PERMISSION_CATALOG } from '../domain/interface/auth/Permission.js';
import MigrationFiles from './MigrationFiles.js';

/**
 * 0080 — favorecido autorizado (ADR-0065). Asserções sobre o FONTE (padrão da 0075/0079: o
 * `MigrationRunner` usa `import.meta` e não roda sob Jest). O comportamento contra um Postgres de
 * verdade está em `0080_sispag_favorecido_autorizado.integration.test.ts`.
 */
const NOME = '0080_sispag_favorecido_autorizado.sql';
const SQL = readFileSync(path.join(__dirname, NOME), 'utf8');

const semComentarios = (texto: string): string =>
    texto
        .split('\n')
        .map((linha) => linha.replace(/--.*$/, ''))
        .join('\n');

const CODIGO = semComentarios(SQL);

const valores = (trecho: string | undefined): string[] =>
    [...(trecho ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '').sort();

const listasDoCheck = (codigo: string): string[][] =>
    [...codigo.matchAll(/CHECK\s*\(\s*permission\s+IN\s*\(([^)]*)\)\s*\)/gi)].map((m) =>
        valores(m[1]),
    );

const TABELAS_DROPADAS = [
    'excecao_destino',
    'excecao_destino_audit',
    'lote_pagamento_item_destino_audit',
    'pendencia_cadastro_origem',
    'pendencia_cadastro',
];

describe('migration 0080 — favorecido autorizado SISPAG (ADR-0065)', () => {
    it('cria a tabela da autorização e a trilha só-inclusão', () => {
        expect(CODIGO).toMatch(/CREATE TABLE IF NOT EXISTS sispag_favorecido_autorizado\s*\(/i);
        expect(CODIGO).toMatch(
            /CREATE TABLE IF NOT EXISTS sispag_favorecido_autorizado_evento\s*\(/i,
        );
        expect(CODIGO).toMatch(/BEFORE UPDATE OR DELETE ON sispag_favorecido_autorizado_evento/i);
        expect(CODIGO).toMatch(/BEFORE TRUNCATE ON sispag_favorecido_autorizado_evento/i);
    });

    it('no máximo uma autorização vigente por (favorecido, modalidade) — índice único parcial', () => {
        const m = CODIGO.match(
            /CREATE UNIQUE INDEX IF NOT EXISTS \w+\s+ON sispag_favorecido_autorizado \(pes_cod, modalidade\)\s+WHERE estado IN \(([^)]*)\)/i,
        );
        expect(m).not.toBeNull();
        expect(valores(m?.[1])).toEqual(['AUTORIZADO', 'PENDENTE', 'REAPROVACAO_PENDENTE']);
    });

    it('os CHECK de estado, modalidade, origem, conferência e eventos têm os valores da ontologia', () => {
        const estado = CODIGO.match(
            /sispag_favorecido_autorizado_estado_check CHECK \(\s*estado IN \(([^)]*)\)/i,
        );
        expect(valores(estado?.[1])).toEqual([
            'AUTORIZADO',
            'PENDENTE',
            'REAPROVACAO_PENDENTE',
            'REJEITADO',
            'REVOGADO',
        ]);
        expect(CODIGO).toMatch(/modalidade IN \('TED', 'PIX'\)/i);
        expect(CODIGO).toMatch(/origem_solicitacao IN \('ITEM', 'RELATORIO', 'MANUAL'\)/i);
        const conferencia = CODIGO.match(/ultima_conferencia_resultado IN \(([^)]*)\)/i);
        expect(valores(conferencia?.[1])).toEqual([
            'DIFERENTE',
            'FALHA_LEITURA',
            'IGUAL',
            'SEM_DADO',
        ]);
        const evento = CODIGO.match(
            /sispag_favorecido_autorizado_evento_evento_check CHECK \(\s*evento IN \(([^)]*)\)/i,
        );
        expect(valores(evento?.[1])).toEqual([
            'APROVADO',
            'CONFERIDO',
            'CONFIRMADO',
            'DESTINO_REVELADO',
            'REAPROVACAO_ABERTA',
            'REJEITADO',
            'REVOGADO',
            'SOLICITADO',
        ]);
    });

    it('AUTORIZADO exige fingerprint; nenhuma coluna guarda conta ou chave completa', () => {
        expect(CODIGO).toMatch(/estado <> 'AUTORIZADO' OR fingerprint IS NOT NULL/i);
        const tabela = CODIGO.match(
            /CREATE TABLE IF NOT EXISTS sispag_favorecido_autorizado\s*\(([\s\S]*?)\n\);/i,
        );
        expect(tabela).not.toBeNull();
        expect(tabela?.[1]).not.toMatch(/\b(conta|agencia|chave_pix|banco_cod)\b/i);
    });

    it('guarda no INÍCIO: aborta se qualquer tabela que vai sumir ainda tiver linha', () => {
        const guarda = CODIGO.search(/RAISE EXCEPTION/i);
        const primeiroDrop = CODIGO.search(/DROP TABLE/i);
        const primeiroCreate = CODIGO.search(/CREATE TABLE/i);
        expect(guarda).toBeGreaterThan(-1);
        expect(guarda).toBeLessThan(primeiroDrop);
        expect(guarda).toBeLessThan(primeiroCreate);
        const bloco = CODIGO.slice(0, primeiroCreate);
        for (const t of TABELAS_DROPADAS) {
            expect(bloco).toContain(`'${t}'`);
        }
        expect(bloco).toMatch(/destino_manual IS NOT NULL/i);
        expect(bloco).toMatch(/to_regclass/i);
    });

    it('dropa as cinco tabelas e as funções só-inclusão da 0067 e da 0075', () => {
        for (const t of TABELAS_DROPADAS) {
            expect(CODIGO).toMatch(new RegExp(`DROP TABLE IF EXISTS ${t}\\b`, 'i'));
        }
        expect(CODIGO).toMatch(/DROP FUNCTION IF EXISTS excecao_destino_audit_so_inclusao\(\)/i);
        expect(CODIGO).toMatch(
            /DROP FUNCTION IF EXISTS lote_pagamento_item_destino_audit_so_inclusao\(\)/i,
        );
    });

    it('lote e item perdem conferência/exceção/destino digitado e o item ganha favorecido_autorizado_id', () => {
        for (const c of [
            'conferido_por',
            'conferido_em',
            'devolvido_por',
            'devolvido_em',
            'motivo_devolucao',
        ]) {
            expect(CODIGO).toMatch(new RegExp(`DROP COLUMN IF EXISTS ${c}\\b`, 'i'));
        }
        for (const c of ['excecao_destino_id', 'destino_manual', 'destino_origem']) {
            expect(CODIGO).toMatch(new RegExp(`DROP COLUMN IF EXISTS ${c}\\b`, 'i'));
        }
        expect(CODIGO).toMatch(
            /DROP CONSTRAINT IF EXISTS lote_pagamento_item_destino_origem_check/i,
        );
        expect(CODIGO).toMatch(/ADD COLUMN IF NOT EXISTS favorecido_autorizado_id UUID NULL/i);
        expect(CODIGO).toMatch(/ADD COLUMN IF NOT EXISTS autorizacao_aviso TEXT NULL/i);
    });

    it('troca os DOIS CHECK de permission pelo catálogo atual: sem excecao/conferir/cadastro', () => {
        const listas = listasDoCheck(CODIGO);
        expect(listas).toHaveLength(2);
        for (const lista of listas) {
            expect(lista).toEqual([...PERMISSION_CATALOG].sort());
            expect(lista).toContain(PERMISSION.SISPAG_AUTORIZAR_FAVORECIDO);
            expect(lista).not.toContain('sispag:excecao');
            expect(lista).not.toContain('sispag:conferir');
            expect(lista).not.toContain('sispag:cadastro');
        }
    });

    it('converte sispag:excecao em sispag:autorizar_favorecido (papel e usuário) e concede ao Administrador', () => {
        expect(CODIGO).toMatch(
            /INSERT INTO app_role_permission[\s\S]*?'sispag:autorizar_favorecido'[\s\S]*?WHERE permission = 'sispag:excecao'[\s\S]*?ON CONFLICT DO NOTHING/i,
        );
        expect(CODIGO).toMatch(
            /INSERT INTO user_permission[\s\S]*?'sispag:autorizar_favorecido'[\s\S]*?WHERE permission = 'sispag:excecao'[\s\S]*?ON CONFLICT DO NOTHING/i,
        );
        expect(CODIGO).toMatch(/lower\(r\.nome\) = 'administrador'/i);
        for (const antiga of ['sispag:excecao', 'sispag:conferir', 'sispag:cadastro']) {
            expect(CODIGO).toMatch(
                new RegExp(
                    `DELETE FROM app_role_permission WHERE permission IN \\([^)]*'${antiga}'`,
                    'i',
                ),
            );
            expect(CODIGO).toMatch(
                new RegExp(
                    `DELETE FROM user_permission WHERE permission IN \\([^)]*'${antiga}'`,
                    'i',
                ),
            );
        }
    });

    it('alerta: sai sispag-excecao-divergencia, entra sispag-destino-alterado (paridade com ALERTA_TIPO)', () => {
        const m = CODIGO.match(/ADD CONSTRAINT alerta_tipo_check\s+CHECK \(tipo IN \(([^)]*)\)\)/i);
        expect(m).not.toBeNull();
        expect(valores(m?.[1])).toEqual([...Object.values(ALERTA_TIPO)].sort());
        expect(valores(m?.[1])).toContain('sispag-destino-alterado');
        expect(valores(m?.[1])).not.toContain('sispag-excecao-divergencia');
        expect(CODIGO).toMatch(/DELETE FROM alerta WHERE tipo = 'sispag-excecao-divergencia'/i);
    });

    it('AlertaItemLote sem CANAL_HABITUAL: apaga as informativas e troca o CHECK', () => {
        expect(CODIGO).toMatch(
            /DELETE FROM lote_pagamento_item_alerta WHERE tipo = 'CANAL_HABITUAL'/i,
        );
        const m = CODIGO.match(
            /ADD CONSTRAINT lote_pagamento_item_alerta_tipo_check\s+CHECK \(tipo IN \(([^)]*)\)\)/i,
        );
        expect(valores(m?.[1])).toEqual(['DUPLICIDADE_FORTE', 'DUPLICIDADE_FRACA']);
    });

    it('idempotente: todo CREATE/ADD/DROP é condicional', () => {
        expect(CODIGO).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/i);
        expect(CODIGO).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/i);
        expect(CODIGO).not.toMatch(/DROP TABLE (?!IF EXISTS)/i);
        expect(CODIGO).not.toMatch(/DROP COLUMN (?!IF EXISTS)/i);
        expect(CODIGO).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/i);
    });

    it('é a lista de permissões mais recente do diretório', () => {
        const comCheck = readdirSync(__dirname)
            .filter((f) => /^\d{4}_.*\.sql$/.test(f))
            .sort()
            .filter((f) =>
                /CHECK\s*\(\s*permission\s+IN/i.test(
                    semComentarios(readFileSync(path.join(__dirname, f), 'utf8')),
                ),
            );
        expect(comCheck[comCheck.length - 1]).toBe(NOME);
    });

    it('é migração de verdade (copiada ao dist/), única com o número 0080, e tem reverse', () => {
        expect(new MigrationFiles().list(__dirname)).toContain(NOME);
        expect(readdirSync(__dirname).filter((f) => /^0080_.*\.sql$/.test(f))).toEqual([NOME]);
        expect(readdirSync(path.join(__dirname, 'rollbacks'))).toContain(
            '0080_sispag_favorecido_autorizado.rollback.sql',
        );
    });
});
