import 'reflect-metadata';
import PerfilQueryInvalidError from '../../errors/PerfilQueryInvalidError.js';
import HistoricoCursor from './HistoricoCursor.js';

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');

describe('HistoricoCursor', () => {
    const cursor = new HistoricoCursor();

    it('encode → decode é identidade, e `em` preserva microssegundos (texto, nunca Date)', () => {
        const posicao = {
            em: '2026-09-30T14:02:03.123456Z',
            fonte: 'remessa' as const,
            fonteId: '42',
        };
        const opaco = cursor.encode(posicao);
        expect(typeof opaco).toBe('string');
        expect(opaco).not.toContain('2026');
        expect(cursor.decode(opaco)).toEqual(posicao);
    });

    it('UUID como fonteId sobrevive à volta', () => {
        const posicao = {
            em: '2026-09-30T14:02:03.000001Z',
            fonte: 'lote_criado' as const,
            fonteId: '7b0c2a1e-5f1c-4c5e-9d55-2b5c1a7e3f00',
        };
        expect(cursor.decode(cursor.encode(posicao))).toEqual(posicao);
    });

    it.each([
        ['base64 inválido', '%%%não-é-base64%%%'],
        ['JSON inválido', b64('{em:')],
        [
            'campos extras',
            b64(
                JSON.stringify({
                    em: '2026-09-30T14:02:03.123456Z',
                    fonte: 'remessa',
                    fonteId: '1',
                    userId: 2,
                }),
            ),
        ],
        [
            'fonte fora do enum',
            b64(
                JSON.stringify({
                    em: '2026-09-30T14:02:03.123456Z',
                    fonte: 'app_user',
                    fonteId: '1',
                }),
            ),
        ],
        ['em sem formato', b64(JSON.stringify({ em: 'ontem', fonte: 'remessa', fonteId: '1' }))],
        ['vazio', ''],
    ])('%s → erro de validação', (_caso, opaco) => {
        expect(() => cursor.decode(opaco)).toThrow(PerfilQueryInvalidError);
    });
});
