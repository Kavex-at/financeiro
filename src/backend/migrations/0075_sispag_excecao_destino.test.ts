import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ALERTA_TIPO } from '../domain/interface/operacao/Alerta.js';
import { PERMISSION, PERMISSION_CATALOG } from '../domain/interface/auth/Permission.js';
import MigrationFiles from './MigrationFiles.js';

/**
 * 0075 — exceção de destino SISPAG (ADR-0061): tabela, trilha só-inclusão, permissão única
 * `sispag:excecao` e o tipo de alerta de divergência.
 *
 * Asserções sobre o FONTE (padrão da 0064/0066/0067/0068: o `MigrationRunner` usa `import.meta` e
 * não roda sob Jest). O comportamento contra um Postgres de verdade está em
 * `0075_sispag_excecao_destino.integration.test.ts`.
 */
const NOME = '0075_sispag_excecao_destino.sql';
const SQL = readFileSync(path.join(__dirname, NOME), 'utf8');

const semComentarios = (texto: string): string =>
    texto
        .split('\n')
        .map((linha) => linha.replace(/--.*$/, ''))
        .join('\n');

const CODIGO = semComentarios(SQL);

const REGEX_CHECK = /CHECK\s*\(\s*permission\s+IN\s*\(([^)]*)\)\s*\)/gi;

const listasDoCheck = (codigo: string): string[][] =>
    [...codigo.matchAll(REGEX_CHECK)].map((m) =>
        [...m[1].matchAll(/'([^']+)'/g)].map((v) => v[1]).sort(),
    );

describe('migration 0075 — exceção de destino SISPAG (ADR-0061)', () => {
    it('cria excecao_destino com o índice único parcial de uma APROVADA por (favorecido, tipo)', () => {
        expect(CODIGO).toMatch(/CREATE TABLE IF NOT EXISTS excecao_destino\s*\(/i);
        expect(CODIGO).toMatch(
            /CREATE UNIQUE INDEX IF NOT EXISTS ux_excecao_destino_aprovada\s+ON excecao_destino \(pes_cod, tipo\)\s+WHERE estado = 'APROVADA'/i,
        );
    });

    it('o CHECK de estado tem os cinco valores e o de tipo CONTA | CHAVE_PIX', () => {
        const estado = CODIGO.match(
            /excecao_destino_estado_check CHECK \(\s*estado IN \(([^)]*)\)/i,
        );
        expect(estado).not.toBeNull();
        expect([...(estado?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()).toEqual([
            'APROVADA',
            'PENDENTE',
            'REJEITADA',
            'REVOGADA',
            'SUBSTITUIDA',
        ]);
        expect(CODIGO).toMatch(
            /excecao_destino_tipo_check CHECK \(tipo IN \('CONTA', 'CHAVE_PIX'\)\)/i,
        );
        expect(CODIGO).toMatch(
            /excecao_destino_origem_check CHECK \(origem IN \('MANUAL', 'PLANILHA'\)\)/i,
        );
    });

    it('o aprovador nunca é o cadastrante (defesa em profundidade da I12b) e PIX só CPF_CNPJ', () => {
        expect(CODIGO).toMatch(/aprovado_por IS NULL OR aprovado_por <> cadastrado_por/i);
        expect(CODIGO).toMatch(/estado <> 'APROVADA' OR \(aprovado_por IS NOT NULL/i);
        expect(CODIGO).toMatch(/chave_pix_tipo = 'CPF_CNPJ'/i);
    });

    it('a trilha é só-inclusão: trigger recusa UPDATE, DELETE e TRUNCATE', () => {
        expect(CODIGO).toMatch(/CREATE TABLE IF NOT EXISTS excecao_destino_audit/i);
        expect(CODIGO).toMatch(/BEFORE UPDATE OR DELETE ON excecao_destino_audit/i);
        expect(CODIGO).toMatch(/BEFORE TRUNCATE ON excecao_destino_audit/i);
        expect(CODIGO).toMatch(/RAISE EXCEPTION/i);
    });

    it('os eventos da trilha são os sete da I12e', () => {
        const m = CODIGO.match(/excecao_destino_audit_evento_check CHECK \(evento IN \(([^)]*)\)/i);
        expect([...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((v) => v[1]).sort()).toEqual(
            [
                'APROVACAO',
                'CADASTRO',
                'DIVERGENCIA_CADASTRO',
                'REJEICAO',
                'REVOGACAO',
                'SUBSTITUICAO',
                'USO',
            ].sort(),
        );
    });

    it('troca os DOIS CHECK de permission pelo catálogo atual e sem aprovar_destino (R4)', () => {
        const listas = listasDoCheck(CODIGO);
        expect(listas).toHaveLength(2);
        for (const lista of listas) {
            expect(lista).toEqual([...PERMISSION_CATALOG].sort());
            expect(lista).toContain(PERMISSION.SISPAG_EXCECAO);
            expect(lista).not.toContain('sispag:aprovar_destino');
        }
    });

    it('a lista mais recente do diretório é o catálogo do código', () => {
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

    it('converte as concessões de aprovar_destino (papel e usuário) ANTES de recriar o CHECK, sem duplicar', () => {
        const dropChecks = CODIGO.search(
            /DROP CONSTRAINT IF EXISTS app_role_permission_permission_check/i,
        );
        const addCheck = CODIGO.search(/ADD CONSTRAINT app_role_permission_permission_check/i);
        const conversao = CODIGO.search(/SELECT role_id, 'sispag:excecao'/i);
        expect(dropChecks).toBeGreaterThan(-1);
        expect(conversao).toBeGreaterThan(dropChecks);
        expect(addCheck).toBeGreaterThan(conversao);
        expect(CODIGO).toMatch(/SELECT user_id, 'sispag:excecao', efeito/i);
        expect(CODIGO.match(/ON CONFLICT DO NOTHING/gi)?.length).toBeGreaterThanOrEqual(3);
    });

    it('o Administrador recebe a permissão; o Analista e outros não são tocados', () => {
        expect(CODIGO).toMatch(/lower\(r\.nome\)\s*=\s*'administrador'/i);
        expect(CODIGO).not.toMatch(/lower\(r\.nome\)\s*=\s*'analista'/i);
    });

    it('o CHECK de alerta.tipo é o catálogo ALERTA_TIPO inteiro (tipo novo sem migration falha)', () => {
        const m = CODIGO.match(
            /ADD CONSTRAINT alerta_tipo_check\s+CHECK\s*\(\s*tipo\s+IN\s*\(([^)]*)\)\s*\)/i,
        );
        expect([...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((v) => v[1]).sort()).toEqual(
            Object.values(ALERTA_TIPO).sort(),
        );
    });

    it('Q4: não apaga nem converte destino_manual (cria-apenas); só avisa', () => {
        expect(CODIGO).not.toMatch(/DROP COLUMN/i);
        expect(CODIGO).not.toMatch(/UPDATE\s+lote_pagamento_item\b/i);
        expect(CODIGO).not.toMatch(/INSERT INTO excecao_destino\b/i);
        expect(CODIGO).toMatch(/RAISE WARNING/i);
        expect(CODIGO).not.toMatch(/DELETE\s+FROM\s+(?!app_role_permission|user_permission)/i);
    });

    it('todo CREATE é idempotente (IF NOT EXISTS / OR REPLACE)', () => {
        const creates = CODIGO.match(/CREATE (UNIQUE )?(TABLE|INDEX)[^\n]*/gi) ?? [];
        expect(creates.length).toBeGreaterThan(0);
        for (const create of creates) expect(create).toMatch(/IF NOT EXISTS/i);
        expect(CODIGO).toMatch(/CREATE OR REPLACE FUNCTION excecao_destino_audit_so_inclusao/i);
        expect(CODIGO).toMatch(/DROP TRIGGER IF EXISTS trg_excecao_destino_audit_so_inclusao ON/i);
    });

    it('é uma migração de verdade: listada pelo MigrationFiles (e portanto copiada ao dist/)', () => {
        expect(new MigrationFiles().list(__dirname)).toContain(NOME);
    });

    it('não há outra migração 0075 (colisão de número entre sessões)', () => {
        expect(readdirSync(__dirname).filter((f) => /^0075_.*\.sql$/.test(f))).toEqual([NOME]);
    });
});
