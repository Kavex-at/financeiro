import { injectable } from 'tsyringe';
import type { Alerta } from '../../interface/operacao/Alerta.js';
import type { AlertSink } from '../../interface/operacao/AlertSink.js';

/**
 * DbAlertSink — o próprio Painel de Operação é o canal (ADR-0042).
 *
 * É o que faz o alerting funcionar **no dia 1, sem credencial nenhuma**, enquanto o
 * `EmailAlertSink` espera o acesso. O alerta já foi persistido por `AlertaRepository.criarSeNovo`
 * antes de chegar aqui — este sink não re-escreve nada; ele existe para que "aparecer no painel"
 * seja um canal explícito na lista de sinks, e não um efeito colateral implícito da persistência.
 *
 * **Teto conhecido:** não consegue alertar que o backend caiu — se o processo não sobe, ninguém
 * escreve a linha. Mesma classe do ponto cego do detector em GH Actions. A solução comum das duas
 * é um dead-man's switch externo, follow-up fora deste slice.
 */
@injectable()
export default class DbAlertSink implements AlertSink {
    public readonly nome = 'painel';

    public entregar = async (_alerta: Alerta): Promise<void> => {
        // No-op deliberado: a persistência já aconteceu a montante. Ver docstring.
    };
}
