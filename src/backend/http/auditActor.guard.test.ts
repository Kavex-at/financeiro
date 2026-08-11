import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { conexosRequestContext } from '../domain/libs/requestContext/ConexosRequestContext.js';
import { auditActor } from './auth.js';
import { conexosIdentityMiddleware } from './conexosIdentity.js';

const BACKEND_ROOT = path.join(__dirname, '..');
const ROUTES_DIR = path.join(BACKEND_ROOT, 'routes');

/** Arquivos de produção de `routes/` (testes e fixtures ficam de fora). */
const productionRouteFiles = (): string[] =>
    readdirSync(ROUTES_DIR)
        .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
        .map((f) => path.join(ROUTES_DIR, f));

describe('auditActor', () => {
    const asReq = (user?: { sub?: string; username?: string; email?: string }): Request =>
        ({ user }) as unknown as Request;

    it('devolve o username — NUNCA o sub, nem quando o username está ausente', () => {
        // O ponto exato que engana: `sub` continua PRESENTE depois do cutover (como UUID),
        // então um `sub ?? username` venceria e gravaria o UUID. O helper não lê `sub`.
        expect(auditActor(asReq({ sub: 'uuid-1111', username: 'marilyn@kavex.com' }))).toBe(
            'marilyn@kavex.com',
        );
        expect(auditActor(asReq({ sub: 'uuid-1111', email: 'marilyn@kavex.com' }))).toBe('unknown');
    });

    it('usa o fallback informado — os dois valores persistidos de hoje são preservados', () => {
        expect(auditActor(asReq(undefined))).toBe('unknown');
        expect(auditActor(asReq(undefined), 'manual')).toBe('manual');
    });

    it('o código-fonte do helper não referencia `sub`', () => {
        const source = readFileSync(path.join(__dirname, 'auth.ts'), 'utf8');
        const body = source.slice(source.indexOf('export const auditActor'));
        const signatureAndBody = body.slice(0, body.indexOf(';') + 1);
        expect(signatureAndBody).toContain('req.user?.username');
        expect(signatureAndBody).not.toContain('sub');
    });
});

describe('GUARDA ANTI-REGRESSÃO — nenhum site de auditoria lê `sub` (I-Usuario-1)', () => {
    /**
     * Esta varredura existe para que a invariante **deixe de depender de code review**.
     *
     * O modo de falha que ela previne é 100% silencioso: `req.user?.sub ?? ...` parece
     * defensivo, mas com `sub` virando UUID ele continua presente, vence o `??` e passa a
     * gravar UUIDs em `executado_por` / `criado_por` / `created_by`. Nenhum erro, nenhum log,
     * nenhum outro teste vermelho — e `BorderosPanel.tsx` renderiza esses valores CRUS na
     * tabela e monta o dropdown "filtrar por usuário" a partir deles.
     *
     * O `??`-com-`sub` foi como as duas doutrinas invertidas apareceram no repositório em
     * primeiro lugar; sem esta guarda, o próximo `feature-new` copia a linha errada.
     */
    it('nenhum arquivo de routes/ combina `req.user?.sub` com um fallback de auditoria', () => {
        const offenders: string[] = [];
        for (const file of productionRouteFiles()) {
            const source = readFileSync(file, 'utf8');
            source.split('\n').forEach((line, i) => {
                // Qualquer expressão que encadeie `req.user?.sub` num `??` é, por construção,
                // um ator de auditoria montado à mão — exatamente o padrão a extinguir.
                if (/req\.user\?\.sub\s*\?\?/.test(line) || /\?\?\s*req\.user\?\.sub/.test(line)) {
                    offenders.push(`${path.basename(file)}:${i + 1}: ${line.trim()}`);
                }
            });
        }
        expect(offenders).toEqual([]);
    });

    it('conexosIdentity.ts não lê `sub` — o ALS é chaveado por username', () => {
        const source = readFileSync(path.join(__dirname, 'conexosIdentity.ts'), 'utf8');
        const code = source
            .split('\n')
            .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('/*'))
            .join('\n');
        expect(code).toContain('req.user?.username');
        expect(code).not.toContain('req.user?.sub');
    });

    it('todo site de auditoria passa pelo helper; os de identidade leem username direto', () => {
        // ARITMÉTICA — por que 28 e não os "19 sites" da ontologia.
        //
        // A ontologia conta as 19 EXPRESSÕES que liam `req.user` para auditar. Duas delas
        // eram helpers locais `ator(req)` — um em `sispag.ts` alimentando 8 chamadas e um em
        // `usuarios.ts` alimentando 1. Removê-los (não reescrevê-los, como manda D1) converte
        // essas 2 expressões nas 9 chamadas diretas correspondentes. E a gestão de usuários
        // ganhou 2 sites NOVOS nesta feature: `POST /convite` (o `created_by` do convidado) e
        // `PATCH /:id/ativo` (o ator que I-Usuario-6 compara com o alvo).
        //
        //     19 - 2 (helpers locais) + 9 (chamadas que eles alimentavam) + 2 (novos) = 28
        //
        // O número que importa não é 19 nem 28: é que existe UMA doutrina. Antes eram três
        // (dois helpers locais + 17 expressões inline, 2 delas com os operandos invertidos).
        const expected: Record<string, number> = {
            'permutas.ts': 13,
            'recebimentos.ts': 4,
            'sispag.ts': 8,
            'usuarios.ts': 3,
        };
        const actual = Object.fromEntries(
            Object.keys(expected).map((f) => [
                f,
                (readFileSync(path.join(ROUTES_DIR, f), 'utf8').match(/auditActor\(req/g) ?? [])
                    .length,
            ]),
        );
        expect(actual).toEqual(expected);

        // Os 2 do fallback `'manual'` mantêm o valor persistido byte-idêntico ao de hoje.
        const recebimentos = readFileSync(path.join(ROUTES_DIR, 'recebimentos.ts'), 'utf8');
        expect((recebimentos.match(/auditActor\(req, 'manual'\)/g) ?? []).length).toBe(2);

        // `me.ts` é LEITURA DE IDENTIDADE: precisa do `undefined` para responder 'ausente'.
        // Um `auditActor` aqui faria `testarVinculo('unknown')` — um SELECT garantidamente
        // vazio, indistinguível de "sem vínculo".
        const me = readFileSync(path.join(ROUTES_DIR, 'me.ts'), 'utf8');
        expect(me).toContain('req.user?.username');
        expect(me).not.toMatch(/auditActor\(/);
    });

    it('os helpers locais `ator` foram REMOVIDOS (não reescritos) de sispag e usuarios', () => {
        for (const f of ['sispag.ts', 'usuarios.ts']) {
            const source = readFileSync(path.join(ROUTES_DIR, f), 'utf8');
            expect(source).not.toMatch(/const ator = \(req: Request\)/);
        }
    });
});

describe('conexosIdentityMiddleware — o ALS carrega o USERNAME, não o UUID', () => {
    const runMiddleware = (user?: { sub?: string; username?: string }): unknown => {
        let captured: unknown;
        const next: NextFunction = () => {
            captured = conexosRequestContext.getStore();
        };
        conexosIdentityMiddleware({ user } as unknown as Request, {} as Response, next);
        return captured;
    };

    it('põe o username no contexto — é o que protege a baixa fin010', () => {
        // `getVinculoConexos` casa por `username`. Um UUID aqui devolveria null e a baixa
        // sairia no nome do ROBÔ, sem erro e sem alarme.
        expect(runMiddleware({ sub: 'uuid-1111', username: 'marilyn@kavex.com' })).toEqual({
            platformUsername: 'marilyn@kavex.com',
        });
    });

    it('sem req.user, continua chamando run({}, next) — o fallback robô é preservado', () => {
        expect(runMiddleware(undefined)).toEqual({});
    });

    it('com req.user mas SEM username resolvido, também cai no robô (nunca no UUID)', () => {
        // Pior cenário: `appUserContext` não rodou. Melhor cair no robô, que é visível na
        // trilha, do que gravar um UUID que parece uma pessoa.
        expect(runMiddleware({ sub: 'uuid-1111' })).toEqual({});
    });
});
