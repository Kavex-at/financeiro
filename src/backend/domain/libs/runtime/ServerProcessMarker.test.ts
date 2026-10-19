import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { container } from 'tsyringe';
import ServerProcessMarker from './ServerProcessMarker.js';

const semComentarios = (fonte: string): string =>
    fonte
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((l) => l.replace(/(^|\s)\/\/.*$/, ''))
        .join('\n');

describe('ServerProcessMarker (I18f/I18g, ADR-0073)', () => {
    it('nasce desligado (job, cron, script) e só liga explicitamente', () => {
        const m = new ServerProcessMarker();
        expect(m.ehServidor()).toBe(false);
        m.ligar();
        expect(m.ehServidor()).toBe(true);
    });

    it('é @singleton: o container devolve a mesma instância', () => {
        expect(container.resolve(ServerProcessMarker)).toBe(container.resolve(ServerProcessMarker));
    });

    it('é ligado no boot do servidor (index.ts), nunca no bootstrapAppContainer', () => {
        const raiz = path.join(__dirname, '..', '..', '..');
        const index = semComentarios(readFileSync(path.join(raiz, 'index.ts'), 'utf8'));
        const appContainer = semComentarios(
            readFileSync(path.join(raiz, 'domain', 'appContainer.ts'), 'utf8'),
        );
        expect(index).toMatch(/resolve\(ServerProcessMarker\)\.ligar\(\)/);
        expect(appContainer).not.toMatch(/ServerProcessMarker/);
    });
});
