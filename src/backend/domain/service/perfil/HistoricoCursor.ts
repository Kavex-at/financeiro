import { injectable } from 'tsyringe';
import { z } from 'zod';
import PerfilQueryInvalidError from '../../errors/PerfilQueryInvalidError.js';
import {
    type CursorHistorico,
    FONTES_ATIVIDADE,
} from '../../interface/perfil/AtividadeUsuarioInterface.js';

/**
 * Instante ISO UTC com até 6 casas de fração — o texto que o Postgres devolve. Fica TEXTO de ponta
 * a ponta: um `Date` do JS truncaria os microssegundos e o keyset pularia ou repetiria linhas.
 */
const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

const cursorSchema = z
    .object({
        em: z.string().regex(INSTANTE),
        fonte: z.enum(FONTES_ATIVIDADE),
        fonteId: z.string().min(1).max(64),
    })
    .strict();

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * HistoricoCursor — o cursor opaco do keyset do histórico: base64url de um JSON validado por Zod.
 * O front nunca o decodifica; qualquer adulteração vira `PerfilQueryInvalidError` (400).
 */
@injectable()
export default class HistoricoCursor {
    public encode = (posicao: CursorHistorico): string =>
        Buffer.from(
            JSON.stringify({ em: posicao.em, fonte: posicao.fonte, fonteId: posicao.fonteId }),
            'utf8',
        ).toString('base64url');

    public decode = (opaco: string): CursorHistorico => {
        if (!BASE64URL.test(opaco)) throw this.invalido();
        let bruto: unknown;
        try {
            bruto = JSON.parse(Buffer.from(opaco, 'base64url').toString('utf8'));
        } catch {
            throw this.invalido();
        }
        const parsed = cursorSchema.safeParse(bruto);
        if (!parsed.success) throw this.invalido();
        return parsed.data;
    };

    private invalido = (): PerfilQueryInvalidError =>
        new PerfilQueryInvalidError('Cursor de paginação inválido. Recarregue o histórico.');
}
