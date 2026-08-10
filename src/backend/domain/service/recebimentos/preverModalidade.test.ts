import 'reflect-metadata';
import { IndiceModalidadePorCliente } from './preverModalidade.js';
import type { ProcessoParaPrevisao } from './preverModalidade.js';

const proc = (dpeNomPessoa: string, priVldTipo?: number, pesCod = 1): ProcessoParaPrevisao => ({
    pesCod,
    dpeNomPessoa,
    ...(priVldTipo !== undefined ? { priVldTipo } : {}),
});

describe('IndiceModalidadePorCliente — cliente com UMA modalidade', () => {
    it('prevê a modalidade e devolve o rótulo humano', () => {
        const i = new IndiceModalidadePorCliente([
            proc('BROWN-FORMAN BEVERAGES WORLDWIDE COM DE BEBIDAS LTDA', 3),
            proc('BROWN-FORMAN BEVERAGES WORLDWIDE COM DE BEBIDAS LTDA', 3),
        ]);
        expect(i.prever('BROWN-FORMAN BEVERAGES')).toEqual({
            priVldTipo: 3,
            rotulo: 'POR ENCOMENDA',
        });
    });

    it('casa com o histórico TRUNCADO do banco (~24 caracteres)', () => {
        // O extrato entrega `"TED 745.0001.BROWN-FORMA"`; o `extrairContraparte` já tirou o canal, e
        // o que sobra é um PREFIXO do nome real. Exigir igualdade deixaria a coluna sempre vazia.
        const i = new IndiceModalidadePorCliente([
            proc('BROWN-FORMAN BEVERAGES WORLDWIDE COM DE BEBIDAS LTDA', 3),
        ]);
        expect(i.prever('BROWN-FORMA')?.priVldTipo).toBe(3);
    });

    it('ignora acento, caixa e sufixo societário', () => {
        const i = new IndiceModalidadePorCliente([proc('PRO NOVA INDÚSTRIA E COMÉRCIO LTDA', 3)]);
        expect(i.prever('pro nova industria e comercio')?.priVldTipo).toBe(3);
    });
});

describe('IndiceModalidadePorCliente — o que NÃO se prevê', () => {
    it('cliente com DUAS modalidades devolve undefined em vez de escolher a maioria', () => {
        // O caso real que motivou a regra: PERNOD RICARD tem 204 processos POR ENCOMENDA e 2
        // PRÓPRIA. A maioria acertaria 99% e erraria justamente nos dois — que são os que decidem se
        // sai uma nota fiscal irreversível.
        const i = new IndiceModalidadePorCliente([
            ...Array.from({ length: 204 }, () => proc('PERNOD RICARD BRASIL', 3)),
            proc('PERNOD RICARD BRASIL', 1),
            proc('PERNOD RICARD BRASIL', 1),
        ]);
        expect(i.prever('PERNOD RICARD BRASIL')).toBeUndefined();
    });

    it('prefixo que casa com DOIS clientes distintos não vira sorteio', () => {
        const i = new IndiceModalidadePorCliente([
            proc('COLUMBIA TRADING', 1),
            proc('COLUMBIA DISTRIBUIDORA', 2),
        ]);
        expect(i.prever('COLUMBIA')).toBeUndefined();
    });

    it('contraparte ausente, vazia ou curta demais não prevê', () => {
        const i = new IndiceModalidadePorCliente([proc('INOX-TECH COMERCIO', 3)]);
        expect(i.prever(undefined)).toBeUndefined();
        expect(i.prever('')).toBeUndefined();
        // Prefixo curto casaria com meia carteira — abaixo do mínimo, nem tenta.
        expect(i.prever('IN')).toBeUndefined();
    });

    it('cliente sem nenhum casamento devolve undefined', () => {
        const i = new IndiceModalidadePorCliente([proc('INOX-TECH COMERCIO', 3)]);
        expect(i.prever('RESGATE COMPROMISSADA')).toBeUndefined();
    });

    it('processo SEM priVldTipo não entra no índice (não inventa modalidade)', () => {
        const i = new IndiceModalidadePorCliente([proc('SKYJACK BRASIL IMPORTACAO', undefined)]);
        expect(i.prever('SKYJACK BRASIL IMPORTACAO')).toBeUndefined();
    });

    it('índice vazio nunca prevê', () => {
        expect(new IndiceModalidadePorCliente([]).prever('QUALQUER COISA')).toBeUndefined();
    });
});

describe('IndiceModalidadePorCliente — código fora do mapa', () => {
    it('rotula o desconhecido em vez de omiti-lo', () => {
        // A previsão é exibição: mostrar `Tipo 99` diz ao analista que existe um código novo. Quem
        // BLOQUEIA por causa dele é o gate 0.5, no servidor, na hora de emitir.
        const i = new IndiceModalidadePorCliente([proc('CLIENTE ESTRANHO SA', 99)]);
        expect(i.prever('CLIENTE ESTRANHO')).toEqual({ priVldTipo: 99, rotulo: 'Tipo 99' });
    });
});
