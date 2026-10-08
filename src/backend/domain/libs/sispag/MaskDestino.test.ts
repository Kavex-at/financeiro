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

    it('destino do favorecido (I14l): TED com banco e agência completos e só os 4 últimos da conta', () => {
        expect(
            mask.destino({
                tipo: 'TED',
                banco: '237',
                agencia: '1234',
                conta: '87654321',
                contaDv: '0',
            }),
        ).toBe('banco 237 · ag. 1234 · cc ****4321-0');
    });

    it('destino do favorecido (I14l): PIX com o tipo e um trecho da chave', () => {
        expect(
            mask.destino({ tipo: 'PIX', chaveTipo: 'EMAIL', chave: 'fornecedor@empresa.com.br' }),
        ).toBe('PIX e-mail f***@empresa.com.br');
        expect(mask.destino({ tipo: 'PIX', chaveTipo: 'CPF_CNPJ', chave: '11144477735' })).toBe(
            'PIX CPF/CNPJ ***.444.777-**',
        );
    });

    it('destino do favorecido nunca contém a conta ou a chave completa', () => {
        const saidas = [
            mask.destino({
                tipo: 'TED',
                banco: '1',
                agencia: '1',
                conta: '987654321',
                contaDv: '2',
            }),
            mask.destino({ tipo: 'PIX', chaveTipo: 'TELEFONE', chave: '+5511987654321' }),
            mask.destino({
                tipo: 'PIX',
                chaveTipo: 'ALEATORIA',
                chave: '123e4567-e89b-12d3-a456-426614174000',
            }),
        ];
        expect(saidas[0]).not.toContain('987654321');
        expect(saidas[1]).not.toContain('987654321');
        expect(saidas[2]).not.toContain('123e4567');
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
