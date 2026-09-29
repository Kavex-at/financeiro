import 'reflect-metadata';
import MaskDestino from './MaskDestino.js';

describe('MaskDestino (I10h — a mesma máscara para log, API e tela)', () => {
    const mask = new MaskDestino();

    it('conta: só os 4 últimos dígitos e o DV', () => {
        expect(mask.conta('12345678', '9')).toBe('****5678-9');
        // Conta curta: nunca mostra os dígitos todos.
        expect(mask.conta('5678', '9')).toBe('****78-9');
        expect(mask.conta('123', undefined)).toBe('****3');
        expect(mask.conta('12', undefined)).toBe('****');
    });

    it('CPF: só o miolo', () => {
        expect(mask.documento('12345678909')).toBe('***.456.789-**');
    });

    it('CNPJ: só o miolo', () => {
        expect(mask.documento('12345678000195')).toBe('**.345.678/****-**');
    });

    it('documento que não é CPF nem CNPJ vira asteriscos', () => {
        expect(mask.documento('123')).toBe('***');
    });

    it('e-mail: primeira letra e o domínio', () => {
        expect(mask.email('joao.silva@dominio.com')).toBe('j***@dominio.com');
        expect(mask.email('semarroba')).toBe('***');
    });

    it('telefone: DDI, DDD e 4 últimos', () => {
        expect(mask.telefone('+5511987654321')).toBe('+55 (11) *****-4321');
    });

    it('aleatória: só os 4 últimos', () => {
        expect(mask.aleatoria('123e4567-e89b-12d3-a456-426614174000')).toBe('****-4000');
    });

    it('chavePix despacha pelo tipo, sem inferir', () => {
        expect(mask.chavePix('CPF_CNPJ', '12345678909')).toBe('***.456.789-**');
        expect(mask.chavePix('EMAIL', 'ana@x.com')).toBe('a***@x.com');
        expect(mask.chavePix(undefined, 'qualquercoisa1234')).toBe('****-1234');
    });

    it('destino manual CONTA e CHAVE_PIX', () => {
        expect(
            mask.destinoManual({
                tipo: 'CONTA',
                bancoCod: '237',
                agencia: '1234',
                conta: '87654321',
                contaDv: '0',
                titularDocumento: '12345678909',
            }),
        ).toBe('banco 237 · ag. 1234 · cc ****4321-0');
        expect(
            mask.destinoManual({
                tipo: 'CHAVE_PIX',
                chavePixTipo: 'EMAIL',
                chavePix: 'fornecedor@empresa.com.br',
                titularDocumento: '12345678909',
            }),
        ).toBe('PIX e-mail f***@empresa.com.br');
    });

    it('nunca devolve o valor completo', () => {
        const valores = [
            mask.conta('87654321', '0'),
            mask.documento('12345678909'),
            mask.documento('12345678000195'),
            mask.email('fornecedor@empresa.com.br'),
            mask.telefone('+5511987654321'),
            mask.aleatoria('123e4567-e89b-12d3-a456-426614174000'),
        ];
        for (const [v, original] of [
            [valores[0], '87654321'],
            [valores[1], '12345678909'],
            [valores[2], '12345678000195'],
            [valores[3], 'fornecedor@empresa.com.br'],
            [valores[4], '+5511987654321'],
            [valores[5], '123e4567-e89b-12d3-a456-426614174000'],
        ]) {
            expect(v).not.toContain(original);
        }
    });
});
