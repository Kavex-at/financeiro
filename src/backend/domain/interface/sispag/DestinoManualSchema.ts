import { z } from 'zod';
import { CHAVE_PIX_TIPO, DESTINO_MANUAL_TIPO } from './SispagInterface.js';

const digitos = (min: number, max: number) =>
    z
        .string()
        .trim()
        .regex(new RegExp(`^\\d{${min},${max}}$`));

/**
 * Forma do destino manual (ADR-0054 D1) — o que o banco guarda em `destino_manual` e o que a rota
 * aceita. É a validação de FORMA (campos e dígitos). A validação de CONTEÚDO (DV de CPF/CNPJ,
 * e-mail, telefone, UUID por tipo de chave, titularidade) é do `DestinoManualValidator`.
 *
 * `titularDocumento` é exigido nos dois tipos: sem ele não há como checar a titularidade (I10i).
 */
export const destinoManualSchema = z.discriminatedUnion('tipo', [
    z
        .object({
            tipo: z.literal(DESTINO_MANUAL_TIPO.CONTA),
            bancoCod: digitos(3, 3),
            agencia: digitos(1, 5),
            agenciaDv: z.string().trim().regex(/^\d$/).optional(),
            conta: digitos(1, 12),
            contaDv: z
                .string()
                .trim()
                .regex(/^\d{1,2}$/),
            titularDocumento: z
                .string()
                .trim()
                .regex(/^(\d{11}|\d{14})$/),
        })
        .strict(),
    z
        .object({
            tipo: z.literal(DESTINO_MANUAL_TIPO.CHAVE_PIX),
            chavePixTipo: z.enum([
                CHAVE_PIX_TIPO.CPF_CNPJ,
                CHAVE_PIX_TIPO.EMAIL,
                CHAVE_PIX_TIPO.TELEFONE,
                CHAVE_PIX_TIPO.ALEATORIA,
            ]),
            chavePix: z.string().trim().min(1).max(77),
            titularDocumento: z
                .string()
                .trim()
                .regex(/^(\d{11}|\d{14})$/),
        })
        .strict(),
]);
