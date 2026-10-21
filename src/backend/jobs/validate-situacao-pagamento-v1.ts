import 'reflect-metadata';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import BankingCalendar from '../domain/libs/calendar/BankingCalendar.js';
import TituloAPagarRepository from '../domain/repository/sispag/TituloAPagarRepository.js';
import SituacaoPagamentoService from '../domain/service/sispag/SituacaoPagamentoService.js';

/**
 * Validação SOMENTE LEITURA da situação de pagamento (ADR-0075) sobre a carteira persistida real:
 * distribuição por estado, motivo principal e dono, cobertura do tipo do documento e exemplos.
 *
 * Lê o Postgres (carteira, bloqueios, ledger de ajuste, pool DDA) e NÃO chama o Conexos, então não
 * abre sessão do robô. Sobe o container com `migrate: false`: NÃO aplica migrations pendentes no
 * banco apontado. Antes rodava o bootstrap completo, e contra o banco de produção isso aplicou a
 * 0089 antes do deploy (20/10/2026). Se o banco estiver atrás do código, a leitura falha alto
 * (coluna inexistente) em vez de migrar.
 *
 * Critérios de aceite (ground truth, ver `ontology/_inbox/sispag-situacao-pagamento-plan.md`):
 *  1. a soma dos bloqueados por motivo principal é igual a `porEstado.BLOQUEADO`;
 *  2. nenhum título aparece sem situação;
 *  3. com `tpd_cod`/`tpd_des_nome` preenchidos (após a primeira ingestão com o código novo), a
 *     contagem de TIPO_PERMUTA bate com a contagem de nomes "(PERMUTA)" da própria carteira.
 */
const EXEMPLOS_POR_MOTIVO = 3;

const main = async (): Promise<void> => {
    await bootstrapAppContainer({ migrate: false });
    const calendar = container.resolve(BankingCalendar);
    const titulos = (await container.resolve(TituloAPagarRepository).listAtivos())
        .filter((t) => !t.pago)
        .map((t) => ({
            ...t,
            ...(t.vencimento !== undefined
                ? { diasAteVencimento: calendar.diasAteVencimento(t.vencimento) }
                : {}),
        }));

    const resumo = await container.resolve(SituacaoPagamentoService).avaliarCarteira(titulos);

    const semSituacao = titulos.filter((t) => t.situacaoPagamento === undefined).length;
    const somaMotivos = Object.values(resumo.porMotivo).reduce((n, t) => n + (t?.qtd ?? 0), 0);
    const comTipo = titulos.filter((t) => t.tpdDesNome !== undefined).length;
    const nomesPermuta = titulos.filter((t) => /PERMUTA/i.test(t.tpdDesNome ?? '')).length;
    const permutaBloqueada = resumo.porMotivo.TIPO_PERMUTA?.qtd ?? 0;

    console.log(`títulos ativos e não pagos: ${titulos.length}`);
    console.log('por estado:', JSON.stringify(resumo.porEstado));
    console.log('por motivo principal:', JSON.stringify(resumo.porMotivo));
    console.log('por dono:', JSON.stringify(resumo.porDono));
    console.log('fontes indisponíveis:', resumo.fontesIndisponiveis);
    console.log(
        `cobertura do tipo: ${comTipo}/${titulos.length}; nomes com PERMUTA: ${nomesPermuta}`,
    );

    const porMotivo = new Map<string, string[]>();
    for (const t of titulos) {
        const s = t.situacaoPagamento;
        if (s?.principal === undefined) continue;
        const lista = porMotivo.get(s.principal) ?? [];
        if (lista.length < EXEMPLOS_POR_MOTIVO) {
            lista.push(
                `fil ${t.filCod} doc ${t.docCod}/${t.titCod} · ${t.credor ?? '—'} · ${s.detalhe ?? ''}`,
            );
        }
        porMotivo.set(s.principal, lista);
    }
    for (const [motivo, exemplos] of porMotivo) {
        console.log(`exemplos ${motivo}:`);
        for (const e of exemplos) console.log(`  - ${e}`);
    }

    const falhas: string[] = [];
    if (semSituacao > 0) falhas.push(`${semSituacao} título(s) sem situação`);
    if (somaMotivos !== resumo.porEstado.BLOQUEADO.qtd) {
        falhas.push(
            `soma dos motivos (${somaMotivos}) ≠ bloqueados (${resumo.porEstado.BLOQUEADO.qtd})`,
        );
    }
    if (comTipo > 0 && permutaBloqueada !== nomesPermuta) {
        // Um título "(PERMUTA)" pode ter outro motivo à frente na prioridade (alçada), por isso só
        // a soma de todos os motivos listados cobre a contagem; aqui é um alerta, não um erro.
        const comMotivoPermuta = titulos.filter((t) =>
            t.situacaoPagamento?.motivos.includes('TIPO_PERMUTA'),
        ).length;
        if (comMotivoPermuta !== nomesPermuta) {
            falhas.push(
                `TIPO_PERMUTA em ${comMotivoPermuta} títulos, mas ${nomesPermuta} têm PERMUTA no nome`,
            );
        }
    }
    if (falhas.length > 0) {
        console.error(`FALHOU: ${falhas.join('; ')}`);
        process.exit(1);
    }
    console.log('OK: critérios 1–3 atendidos');
};

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('FAILED:', error instanceof Error ? error.stack : String(error));
        process.exit(1);
    });
