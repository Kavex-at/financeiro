import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Escopo do boleto agrupado (ADR-0077, Task 23): o fluxo roda só no servidor Express, atrás das
 * rotas e dos serviços. Nenhum job de cron, nenhum Lambda e nada no `bootstrapAppContainer`
 * (compartilhado com ~58 jobs) pode puxar os serviços do grupo ou do borderô do grupo.
 */
const RAIZ = path.resolve(__dirname, '../../..');
const SERVICOS = /\b(BorderoGrupoBoletoService|GrupoBoletoService)\b/;

const arquivos = (dir: string): string[] =>
    readdirSync(dir).flatMap((nome) => {
        const caminho = path.join(dir, nome);
        if (nome === 'node_modules' || nome === 'dist') return [];
        if (statSync(caminho).isDirectory()) return arquivos(caminho);
        return caminho.endsWith('.ts') && !caminho.endsWith('.test.ts') ? [caminho] : [];
    });

const relativo = (f: string): string => path.relative(RAIZ, f).split(path.sep).join('/');

/** Onde a referência aos serviços do grupo é permitida. */
const PERMITIDO = [
    /^domain\/service\//,
    /^domain\/interface\//,
    /^domain\/libs\//,
    /^routes\//,
    // Verificação em HML: roda o serviço de produção contra o ERP de homologação, à mão.
    /^jobs\/probe-hml-boleto-agrupado-e2e\.ts$/,
    /^jobs\/hmlE2eGuarda\.ts$/,
];

describe('boleto agrupado — escopo (ADR-0077, Task 23)', () => {
    const fontes = arquivos(RAIZ);

    it('os serviços do grupo só aparecem em routes/, domain/service|interface|libs e no job de prova HML', () => {
        const fora = fontes
            .filter((f) => SERVICOS.test(readFileSync(f, 'utf8')))
            .map(relativo)
            .filter((r) => !PERMITIDO.some((re) => re.test(r)));
        expect(fora).toEqual([]);
    });

    it('nada nos containers de composição (compartilhados com os jobs)', () => {
        for (const container of ['appContainer.ts', 'recebimentosContainer.ts']) {
            const f = fontes.find((x) => relativo(x) === `domain/${container}`);
            expect(f).toBeDefined();
            expect(readFileSync(f as string, 'utf8')).not.toMatch(SERVICOS);
        }
    });

    it('nenhum handler Lambda novo: o backend segue Express', () => {
        const lambdas = fontes.map(relativo).filter((r) => r.startsWith('lambda/'));
        expect(lambdas).toEqual([]);
    });

    it('jobs do boleto agrupado são só de verificação (probe HML, guarda, validação PRD)', () => {
        const jobs = fontes
            .map(relativo)
            .filter((r) => r.startsWith('jobs/') && /agrupado|hmlE2e/i.test(r))
            .sort();
        expect(jobs).toEqual([
            'jobs/hmlE2eGuarda.ts',
            'jobs/probe-hml-boleto-agrupado-e2e.ts',
            'jobs/probe-hml-boleto-agrupado-tdd.ts',
            'jobs/probe-hml-boleto-agrupado.ts',
            'jobs/validate-sispag-boleto-agrupado-v1.ts',
        ]);
    });
});
