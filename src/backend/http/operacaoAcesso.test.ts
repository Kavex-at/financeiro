import 'reflect-metadata';
import { usuarioPodeVerOperacao } from './operacaoAcesso.js';

describe('usuarioPodeVerOperacao — recorte por identidade, não por papel', () => {
    it('lista VAZIA libera qualquer um: fail-open é a escolha, não um descuido', () => {
        // O painel é ferramenta de incidente. Env ausente não pode trancar a porta na hora de
        // diagnosticar — um lockout silencioso durante uma queda é pior que a exposição.
        expect(usuarioPodeVerOperacao('qualquer', [])).toBe(true);
        expect(usuarioPodeVerOperacao(undefined, [])).toBe(true);
    });

    it('com lista, só quem está nela passa', () => {
        expect(usuarioPodeVerOperacao('admin', ['admin'])).toBe(true);
        expect(usuarioPodeVerOperacao('simone', ['admin'])).toBe(false);
    });

    it('compara sem diferenciar maiúsculas — erro de digitação na env não vira lockout mudo', () => {
        expect(usuarioPodeVerOperacao('Admin', ['admin'])).toBe(true);
        expect(usuarioPodeVerOperacao('  ADMIN  ', ['admin'])).toBe(true);
    });

    it('com lista configurada, usuário ausente é negado', () => {
        expect(usuarioPodeVerOperacao(undefined, ['admin'])).toBe(false);
        expect(usuarioPodeVerOperacao('   ', ['admin'])).toBe(false);
    });

    it('aceita mais de um usuário — allow-list, não dono único', () => {
        // Um painel de incidente que só uma pessoa vê é um painel que ninguém vê quando essa
        // pessoa está dormindo.
        const lista = ['admin', 'yuri'];
        expect(usuarioPodeVerOperacao('yuri', lista)).toBe(true);
        expect(usuarioPodeVerOperacao('admin', lista)).toBe(true);
        expect(usuarioPodeVerOperacao('simone', lista)).toBe(false);
    });
});
