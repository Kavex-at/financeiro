import 'reflect-metadata';
import {
    type AgregadosAtividade,
    type LinhaAtividadeBruta,
    STATUS_POR_FONTE,
} from '../../interface/perfil/AtividadeUsuarioInterface.js';
import { PERMISSION_CATALOG } from '../../interface/auth/Permission.js';
import type Clock from '../../libs/clock/Clock.js';
import EffectivePermissionCalculator from '../auth/EffectivePermissionCalculator.js';
import HistoricoCursor from './HistoricoCursor.js';
import PerfilService from './PerfilService.js';
import PeriodoPerfil, { TIPO_PERIODO } from './PeriodoPerfil.js';

const AGORA = new Date('2026-10-01T15:00:00.000Z');
const ALVO = { userId: 7, username: 'ana.souza' };

const zeros = (): AgregadosAtividade => ({
    permutas: { concluidas: 0, parciais: 0, valorBaixado: 0, aguardandoBordero: 0, comErro: 0 },
    sispag: {
        lotesFinalizados: 0,
        remessasGeradas: 0,
        valorRemessado: 0,
        valorAgendado: 0,
        valorPagoConfirmado: 0,
        retornosConciliados: 0,
        comErro: 0,
    },
    recebimentos: { concluidas: 0, valor: 0, comErro: 0 },
});

const linhaBruta = (i: number, over: Partial<LinhaAtividadeBruta> = {}): LinhaAtividadeBruta => ({
    em: `2026-09-30T14:02:${String(59 - (i % 60)).padStart(2, '0')}.123456Z`,
    frente: 'sispag',
    acao: 'remessa_gerada',
    alvoTipo: 'lote',
    alvoId: `lote-${i}`,
    statusBruto: 'settled',
    fonte: 'remessa',
    fonteId: String(1000 - i),
    detalhe: {},
    ...over,
});

const montar = (over: { identidade?: unknown; fontes?: unknown; historico?: unknown[] } = {}) => {
    const perfilRepo = {
        buscarIdentidade: jest.fn().mockResolvedValue(
            over.identidade === undefined
                ? {
                      userId: 7,
                      username: 'ana.souza',
                      ativo: true,
                      membroDesde: '2026-08-01T12:00:00.000Z',
                      papel: { id: 2, nome: 'Operador' },
                  }
                : over.identidade,
        ),
        buscarFontesDePermissao: jest
            .fn()
            .mockResolvedValue(over.fontes ?? { pacote: [], excecoes: [] }),
    };
    const atividadeRepo = {
        agregados: jest.fn().mockResolvedValue(zeros()),
        historico: jest.fn().mockResolvedValue(over.historico ?? []),
    };
    const clock = { now: () => AGORA.getTime() } as Clock;
    const service = new PerfilService(
        perfilRepo as never,
        atividadeRepo as never,
        new PeriodoPerfil(clock),
        new HistoricoCursor(),
        new EffectivePermissionCalculator(),
    );
    return { service, perfilRepo, atividadeRepo };
};

describe('PerfilService.perfil — identidade', () => {
    it('lê só o alvo recebido como argumento; e-mail/criadoPor/vínculo ausentes viram null', async () => {
        const { service, perfilRepo } = montar();
        const r = await service.perfil(ALVO);
        expect(perfilRepo.buscarIdentidade).toHaveBeenCalledWith(7);
        expect(perfilRepo.buscarFontesDePermissao).toHaveBeenCalledWith(7);
        expect(r).toMatchObject({
            username: 'ana.souza',
            email: null,
            ativo: true,
            membroDesde: '2026-08-01T12:00:00.000Z',
            criadoPor: null,
            papel: { id: 2, nome: 'Operador', descricao: null },
            conexos: { vinculado: false, conexosUsername: null },
        });
    });

    it('com vínculo Conexos: vinculado = true', async () => {
        const { service } = montar({
            identidade: {
                userId: 7,
                username: 'ana.souza',
                email: 'ana@x.com',
                ativo: true,
                membroDesde: '2026-08-01T12:00:00.000Z',
                criadoPor: 'admin',
                papel: { id: 2, nome: 'Operador', descricao: 'd' },
                conexosUsername: 'ANA_SOUZA',
            },
        });
        const r = await service.perfil(ALVO);
        expect(r.conexos).toEqual({ vinculado: true, conexosUsername: 'ANA_SOUZA' });
        expect(r.email).toBe('ana@x.com');
    });

    it('usuário do alvo inexistente → erro (nunca um perfil vazio inventado)', async () => {
        const { service } = montar({ identidade: null });
        await expect(service.perfil(ALVO)).rejects.toThrow();
    });
});

describe('PerfilService.perfil — origem das permissões', () => {
    const fontes = {
        pacote: ['permutas:executar', 'sispag:ver', 'recebimentos:executar', 'valor:antigo'],
        excecoes: [
            {
                permissao: 'metricas:ver',
                efeito: 'conceder',
                concedidoPor: 'admin',
                concedidoEm: '2026-09-01T10:00:00.000Z',
            },
            {
                permissao: 'sispag:ver',
                efeito: 'revogar',
                concedidoPor: 'gestor',
                concedidoEm: '2026-09-02T10:00:00.000Z',
            },
            {
                permissao: 'recebimentos:ver',
                efeito: 'revogar',
                concedidoPor: 'gestor',
                concedidoEm: '2026-09-03T10:00:00.000Z',
            },
        ],
    };

    it('4 origens: papel, concedida (por/em), revogada (efetiva false), implicada', async () => {
        const { service } = montar({ fontes });
        const { permissoes } = await service.perfil(ALVO);
        const por = (codigo: string) => permissoes.find((p) => p.codigo === codigo);

        expect(por('permutas:executar')).toEqual({
            codigo: 'permutas:executar',
            efetiva: true,
            origem: 'papel',
        });
        expect(por('permutas:ver')).toEqual({
            codigo: 'permutas:ver',
            efetiva: true,
            origem: 'implicada',
            implicadaPor: 'permutas:executar',
        });
        expect(por('metricas:ver')).toEqual({
            codigo: 'metricas:ver',
            efetiva: true,
            origem: 'concedida',
            por: 'admin',
            em: '2026-09-01T10:00:00.000Z',
        });
        expect(por('sispag:ver')).toEqual({
            codigo: 'sispag:ver',
            efetiva: false,
            origem: 'revogada',
            por: 'gestor',
            em: '2026-09-02T10:00:00.000Z',
        });
        // Revogar `ver` derruba o `executar` do papel: aparece como revogada, com o autor do `ver`.
        expect(por('recebimentos:executar')).toEqual({
            codigo: 'recebimentos:executar',
            efetiva: false,
            origem: 'revogada',
            por: 'gestor',
            em: '2026-09-03T10:00:00.000Z',
        });
        // Fora do catálogo nunca aparece; o que nunca foi dado também não.
        expect(por('valor:antigo' as never)).toBeUndefined();
        expect(por('usuarios:gerenciar')).toBeUndefined();
    });

    it('o conjunto efetiva = true é exatamente o do EffectivePermissionCalculator', async () => {
        const casos = [
            fontes,
            { pacote: [...PERMISSION_CATALOG], excecoes: [] },
            { pacote: [], excecoes: [] },
            {
                pacote: ['sispag:executar'],
                excecoes: [
                    {
                        permissao: 'sispag:executar',
                        efeito: 'revogar',
                        concedidoPor: 'g',
                        concedidoEm: '2026-09-01T00:00:00.000Z',
                    },
                ],
            },
        ];
        const calculadora = new EffectivePermissionCalculator();
        for (const caso of casos) {
            const { service } = montar({ fontes: caso });
            const { permissoes } = await service.perfil(ALVO);
            const efetivas = permissoes.filter((p) => p.efetiva).map((p) => p.codigo);
            const esperado = calculadora.calcular(
                caso.pacote,
                caso.excecoes.map((e) => ({ permissao: e.permissao, efeito: e.efeito })),
            ).permissoes;
            expect(new Set(efetivas)).toEqual(esperado);
        }
    });

    it('segue a ordem do catálogo', async () => {
        const { service } = montar({ fontes: { pacote: [...PERMISSION_CATALOG], excecoes: [] } });
        const { permissoes } = await service.perfil(ALVO);
        expect(permissoes.map((p) => p.codigo)).toEqual([...PERMISSION_CATALOG]);
    });
});

describe('PerfilService.atividade', () => {
    it('consulta o período e o anterior com o username do alvo, e devolve atual/anterior por frente', async () => {
        const { service, atividadeRepo } = montar();
        const atual = zeros();
        atual.permutas.concluidas = 3;
        const anterior = zeros();
        anterior.permutas.concluidas = 1;
        atividadeRepo.agregados.mockResolvedValueOnce(atual).mockResolvedValueOnce(anterior);

        const r = await service.atividade({ alvo: ALVO, periodo: { tipo: TIPO_PERIODO.SEMANA } });

        // Semana na grade sexta 18:00 SP: em 01/10 (quinta) começou em 25/09 18:00 SP = 21:00Z.
        expect(r.periodo).toEqual({
            tipo: 'semana',
            inicio: '2026-09-25T21:00:00.000Z',
            fim: AGORA.toISOString(),
        });
        expect(r.periodoAnterior.fim).toBe('2026-09-25T21:00:00.000Z');
        expect(atividadeRepo.agregados).toHaveBeenNthCalledWith(1, {
            username: 'ana.souza',
            inicio: '2026-09-25T21:00:00.000Z',
            fim: AGORA.toISOString(),
        });
        expect(atividadeRepo.agregados.mock.calls[1][0].fim).toBe('2026-09-25T21:00:00.000Z');
        expect(r.permutas).toEqual({ atual: atual.permutas, anterior: anterior.permutas });
        expect(r.sispag.atual).toEqual(atual.sispag);
        expect(r.recebimentos.anterior).toEqual(anterior.recebimentos);
    });

    it('período inválido propaga o erro de validação', async () => {
        const { service } = montar();
        await expect(
            service.atividade({
                alvo: ALVO,
                periodo: {
                    tipo: TIPO_PERIODO.PERSONALIZADO,
                    inicio: '2026-09-10',
                    fim: '2026-09-01',
                },
            }),
        ).rejects.toThrow('período');
    });
});

describe('PerfilService.historico', () => {
    it('pede limit + 1 (26), devolve 25 e um cursor quando há a 26ª', async () => {
        const linhas = Array.from({ length: 26 }, (_, i) => linhaBruta(i));
        const { service, atividadeRepo } = montar({ historico: linhas });

        const r = await service.historico({ alvo: ALVO, filtros: {} });

        const consulta = atividadeRepo.historico.mock.calls[0][0];
        expect(consulta).toMatchObject({ userId: 7, username: 'ana.souza', limit: 26 });
        expect(consulta.cursor).toBeUndefined();
        expect(r.itens).toHaveLength(25);
        expect(r.proximoCursor).toBeDefined();
        // O cursor aponta a 25ª linha devolvida (a última da página).
        const decodificado = new HistoricoCursor().decode(r.proximoCursor ?? '');
        expect(decodificado).toEqual({
            em: linhas[24].em,
            fonte: linhas[24].fonte,
            fonteId: linhas[24].fonteId,
        });
    });

    it('sem a 26ª linha, proximoCursor ausente', async () => {
        const { service } = montar({ historico: [linhaBruta(0)] });
        const r = await service.historico({ alvo: ALVO, filtros: {} });
        expect(r.itens).toHaveLength(1);
        expect(r).not.toHaveProperty('proximoCursor');
    });

    it('repassa o cursor decodificado e os filtros; janela default de 30 dias', async () => {
        const { service, atividadeRepo } = montar();
        const opaco = new HistoricoCursor().encode({
            em: '2026-09-20T10:00:00.000001Z',
            fonte: 'conciliacao',
            fonteId: '3',
        });
        await service.historico({
            alvo: ALVO,
            filtros: { frente: 'sispag', status: 'erro', tipo: 'remessa_gerada' },
            cursor: opaco,
        });
        const consulta = atividadeRepo.historico.mock.calls[0][0];
        expect(consulta).toMatchObject({
            frente: 'sispag',
            status: 'erro',
            tipo: 'remessa_gerada',
            cursor: { em: '2026-09-20T10:00:00.000001Z', fonte: 'conciliacao', fonteId: '3' },
            fim: AGORA.toISOString(),
            inicio: new Date(AGORA.getTime() - 30 * 24 * 3600 * 1000).toISOString(),
        });
    });

    it('cursor adulterado → erro de validação, sem consultar o banco', async () => {
        const { service, atividadeRepo } = montar();
        await expect(
            service.historico({ alvo: ALVO, filtros: {}, cursor: 'lixo!!' }),
        ).rejects.toThrow();
        expect(atividadeRepo.historico).not.toHaveBeenCalled();
    });

    it('mapeia status bruto → normalizado pela tabela única, e nunca expõe dry_run', async () => {
        const brutas: LinhaAtividadeBruta[] = [
            linhaBruta(0, {
                fonte: 'permuta_execucao',
                statusBruto: 'parcial',
                detalhe: { parcial: true },
            }),
            linhaBruta(1, { fonte: 'permuta_execucao', statusBruto: 'error' }),
            linhaBruta(2, { fonte: 'remessa', statusBruto: 'reconciling' }),
            linhaBruta(3, { fonte: 'lote_finalizado', statusBruto: 'CANCELADO' }),
            linhaBruta(4, { fonte: 'lote_criado', statusBruto: 'RASCUNHO' }),
            linhaBruta(5, { fonte: 'acesso_evento', statusBruto: 'papel' }),
        ];
        const { service } = montar({ historico: brutas });
        const r = await service.historico({ alvo: ALVO, filtros: {} });
        expect(r.itens.map((l) => l.status)).toEqual([
            'sucesso',
            'erro',
            'em_andamento',
            'cancelado',
            'info',
            'info',
        ]);
        for (const item of r.itens) {
            expect(item).not.toHaveProperty('statusBruto');
            expect(JSON.stringify(item)).not.toMatch(/dry_?run/i);
        }
        // A tabela usada é a constante exportada (uma fonte só da verdade).
        expect(STATUS_POR_FONTE.permuta_execucao.parcial).toBe('sucesso');
    });

    it('status bruto desconhecido vira info (nunca derruba a página)', async () => {
        const { service } = montar({
            historico: [linhaBruta(0, { fonte: 'remessa', statusBruto: 'novo_status' })],
        });
        const r = await service.historico({ alvo: ALVO, filtros: {} });
        expect(r.itens[0].status).toBe('info');
    });
});
