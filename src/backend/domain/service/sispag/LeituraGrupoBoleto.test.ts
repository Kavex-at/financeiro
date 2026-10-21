import 'reflect-metadata';
import type { GrupoBoleto } from '../../interface/sispag/GrupoBoletoInterface.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import { ETAPA_BORDERO_GRUPO } from '../../libs/boleto/EtapaBorderoGrupo.js';
import type BloqueioDuplicidadeRepository from '../../repository/sispag/BloqueioDuplicidadeRepository.js';
import type BoletoDdaRepository from '../../repository/sispag/BoletoDdaRepository.js';
import type GrupoBoletoExecucaoRepository from '../../repository/sispag/GrupoBoletoExecucaoRepository.js';
import type TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import LeituraGrupoBoleto from './LeituraGrupoBoleto.js';
import RegraGrupoBoleto from './RegraGrupoBoleto.js';

const grupo = (over: Partial<GrupoBoleto> = {}): GrupoBoleto =>
    ({
        id: 'G1',
        filCod: 2,
        pesCod: '9001',
        emissorChave: '341:1',
        ddcCod: 900,
        ditCod: 1,
        codbarMascarado: '34191…7500',
        valorBoletoCentavos: 105_000,
        vencimentoBoleto: '2026-10-21',
        titulos: ['1', '2'].map((docCod) => ({
            filCod: 2,
            docCod,
            titCod: '1',
            valorLiquidoCentavos: 52_500,
            vencimento: '2026-10-21',
        })),
        somaTitulosCentavos: 105_000,
        origem: 'SUGERIDO',
        intercambiavel: false,
        avisosReconhecidos: [],
        estado: 'CONFIRMADO',
        confirmadoPor: 'ana',
        confirmadoEm: new Date(),
        versao: 1,
        ...over,
    }) as GrupoBoleto;

const montar = () => {
    const boletos = { buscarPorChave: jest.fn().mockResolvedValue({ ddcCod: 900, ditCod: 1 }) };
    const titulos = {
        buscarPorChave: jest.fn(async (c: { filCod: number; docCod: string; titCod: string }) => ({
            ...c,
            valor: 525,
            liberado: true,
            pago: false,
            ativo: true,
            temBoleto: false,
        })),
    };
    const bloqueios = { findAtivo: jest.fn().mockResolvedValue(null) };
    const execucoes = { listarPorGrupo: jest.fn().mockResolvedValue([]) };
    const leitura = new LeituraGrupoBoleto(
        boletos as unknown as BoletoDdaRepository,
        titulos as unknown as TituloAPagarRepository,
        bloqueios as unknown as BloqueioDuplicidadeRepository,
        execucoes as unknown as GrupoBoletoExecucaoRepository,
        new RegraGrupoBoleto(new CodigoBarrasBoleto()),
    );
    return { leitura, boletos, titulos, bloqueios, execucoes };
};

const exec = (criado: string, etapa: string, jRejeitado?: string) => ({
    criadoEm: new Date(criado),
    etapa,
    ...(jRejeitado ? { jRejeitadoEm: new Date(jRejeitado) } : {}),
});

describe('LeituraGrupoBoleto — leituras locais do grupo (ADR-0077)', () => {
    it('I21u: boleto no pool e títulos ativos em aberto ⇒ não órfão', async () => {
        const { leitura } = montar();
        await expect(leitura.orfao(grupo())).resolves.toEqual({ orfao: false });
    });

    it('I21u: boleto fora do pool / vinculado pelo ERP / título pago, inativo ou com DDA do ERP ⇒ órfão com o motivo', async () => {
        const fora = montar();
        fora.boletos.buscarPorChave.mockResolvedValue(null);
        expect((await fora.leitura.orfao(grupo())).motivo).toBe('BOLETO_FORA_DO_POOL');

        const vinculado = montar();
        vinculado.boletos.buscarPorChave.mockResolvedValue({ filCod: 2, docCod: '9', titCod: '1' });
        expect((await vinculado.leitura.orfao(grupo())).motivo).toBe('BOLETO_VINCULADO_ERP');

        const pago = montar();
        pago.titulos.buscarPorChave.mockImplementation(async (c) => ({
            ...c,
            valor: 525,
            liberado: true,
            pago: c.docCod === '2',
            ativo: true,
            temBoleto: false,
        }));
        expect(await pago.leitura.orfao(grupo())).toEqual({
            orfao: true,
            motivo: 'TITULO_PAGO',
            titulo: { filCod: 2, docCod: '2', titCod: '1' },
        });

        const sumiu = montar();
        sumiu.titulos.buscarPorChave.mockResolvedValueOnce(null as never);
        expect((await sumiu.leitura.orfao(grupo())).motivo).toBe('TITULO_INATIVO');

        const dda = montar();
        dda.titulos.buscarPorChave.mockImplementation(async (c) => ({
            ...c,
            valor: 525,
            liberado: true,
            pago: false,
            ativo: true,
            temBoleto: true,
        }));
        expect((await dda.leitura.orfao(grupo())).motivo).toBe('TITULO_COM_DDA_ERP');
    });

    it('titulosRetidos devolve os títulos com marca ATIVA (qualquer origem)', async () => {
        const { leitura, bloqueios } = montar();
        bloqueios.findAtivo.mockImplementation(async (c: { docCod: string }) =>
            c.docCod === '2' ? { origem: 'GRUPO_BOLETO' } : null,
        );
        await expect(leitura.titulosRetidos(grupo())).resolves.toEqual([
            { filCod: 2, docCod: '2', titCod: '1' },
        ]);
    });

    it('I21r: J rejeitado sem execução posterior concluída ⇒ rejeição não resolvida; concluída depois ⇒ resolvida', async () => {
        const { leitura, execucoes } = montar();
        execucoes.listarPorGrupo.mockResolvedValue([
            exec('2026-10-10T10:00:00Z', ETAPA_BORDERO_GRUPO.CONCLUIDO, '2026-10-12T10:00:00Z'),
        ]);
        await expect(leitura.rejeicaoNaoResolvida('G1')).resolves.toBe(true);
        execucoes.listarPorGrupo.mockResolvedValue([
            exec('2026-10-10T10:00:00Z', ETAPA_BORDERO_GRUPO.CONCLUIDO, '2026-10-12T10:00:00Z'),
            exec('2026-10-15T10:00:00Z', ETAPA_BORDERO_GRUPO.CONCLUIDO),
        ]);
        await expect(leitura.rejeicaoNaoResolvida('G1')).resolves.toBe(false);
    });

    it('situação: no lote rascunho ⇒ EM_LOTE; sem lote e rejeitado ⇒ REJEITADO; divergente vence; retido e órfão vêm do contexto', async () => {
        const { leitura, execucoes } = montar();
        await expect(leitura.situacao(grupo(), { loteStatus: 'RASCUNHO' })).resolves.toBe(
            'EM_LOTE',
        );
        await expect(leitura.situacao(grupo())).resolves.toBe('DISPONIVEL');
        await expect(leitura.situacao(grupo(), { orfao: true })).resolves.toBe('ORFAO');
        await expect(leitura.situacao(grupo(), { marcaRetencaoAtiva: true })).resolves.toBe(
            'RETIDO',
        );
        await expect(
            leitura.situacao(grupo(), { loteStatus: 'RETORNADO', divergente: true }),
        ).resolves.toBe('DIVERGENTE');
        execucoes.listarPorGrupo.mockResolvedValue([
            exec('2026-10-10T10:00:00Z', ETAPA_BORDERO_GRUPO.CONCLUIDO, '2026-10-12T10:00:00Z'),
        ]);
        await expect(leitura.situacao(grupo())).resolves.toBe('REJEITADO');
        await expect(leitura.situacao(grupo({ estado: 'ANULADO' }))).resolves.toBe('ANULADO');
    });
});
