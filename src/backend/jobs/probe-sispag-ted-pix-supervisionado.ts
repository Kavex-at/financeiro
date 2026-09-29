import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton.
import 'dotenv/config';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import { CAMPO_DOCUMENTO_FAVORECIDO } from '../domain/client/ConexosSispagClient.js';

/**
 * SONDA READ-ONLY do teste supervisionado de TED/PIX (ADR-0054, checklist do
 * `ontology/_inbox/sispag-ted-pix-tasks.md`, passos 4, 5, 7 e 10). NÃO foi executada neste ciclo.
 *
 * ⚠️ ANTES DE RODAR:
 *   - use uma credencial Conexos PRÓPRIA no `.env` local. A sonda de 2026-09-28 logou com um
 *     usuário no limite de sessões e derrubou duas sessões de outras pessoas (plano §7);
 *   - rode com `databaseConnectionString=""`: a sessão do robô `columbia-default` é contaminável
 *     por script local apontado para o banco de produção.
 *
 * PERGUNTAS:
 *   H6. O item importado no fin015 ficou com `itsVldModalidade = 5` (TED) ou o ERP sobrescreveu?
 *   H7. Que `fbtCod`/`fbtDesDescr`/`fbtEspCodbanco` o ERP gravou no item (finalidade do TED?)
 *   H3. O item TED de destino digitado entrou SEM `pctCodSeq`?
 *   H4. O item PIX saiu com `itsVldChavePix = 1`?
 *   Doc. Quais campos da pessoa (`cmn025/list`) parecem CPF/CNPJ — para confirmar
 *        `CAMPO_DOCUMENTO_FAVORECIDO`?
 *
 * SEGURANÇA: só `/list`. Nenhum verbo de escrita, nenhuma chamada a `validacao/*` (H1 não
 * provado). Conta, chave e documento saem MASCARADOS; erros imprimem só a mensagem.
 *
 * Run:
 *   cd src/backend && PROBE_PRD=1 databaseConnectionString="" \
 *     npx tsx jobs/probe-sispag-ted-pix-supervisionado.ts --fil 1 --flp 123 --pes 4567
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml') && process.env.PROBE_PRD !== '1') {
    console.error(`RECUSADO: base não é HML (${BASE}). Para PRD passe PROBE_PRD=1.`);
    process.exit(1);
}

type Row = Record<string, unknown>;

class ProbeTedPixSupervisionado {
    private base = container.resolve(ConexosBaseClient);

    public constructor(
        private readonly filCod: number,
        private readonly flpCod: number,
        private readonly pesCod: string,
    ) {}

    public static argumento = (nome: string): string | undefined => {
        const i = process.argv.indexOf(`--${nome}`);
        return i >= 0 ? process.argv[i + 1] : undefined;
    };

    /** Mostra no máximo os 3 últimos caracteres. Nunca o valor inteiro. */
    private mascarar = (v: unknown): string => {
        const s = String(v ?? '').trim();
        if (!s) return '(vazio)';
        return s.length <= 4 ? '*'.repeat(s.length) : `${'*'.repeat(s.length - 3)}${s.slice(-3)}`;
    };

    private cheio = (v: unknown): boolean =>
        v !== null && v !== undefined && String(v).trim() !== '';

    private listar = async (endpoint: string, filtro: Row, pageSize = 200): Promise<Row[]> => {
        const serviceName = endpoint.split('/')[0] ?? endpoint;
        const { rows } = await this.base.listGenericPaginated<Row>(
            endpoint,
            { fieldList: [], filterList: filtro, serviceName, pageNumber: 1, pageSize },
            { filCod: this.filCod },
        );
        return rows;
    };

    public run = async (): Promise<void> => {
        await bootstrapAppContainer();
        await this.base.ensureSid();

        console.log(`\n── lote nativo fil=${this.filCod} flp=${this.flpCod} ──`);
        const lotes = await this.listar('fin015/list', { 'filCod#EQ': this.filCod }, 500);
        const lote = lotes.find((l) => Number(l.flpCod) === this.flpCod);
        if (!lote) {
            console.log('lote nativo não encontrado no fin015/list desta filial');
        } else {
            await this.itensDoLote(Number(lote.bncCod));
        }

        console.log(`\n── pessoa pes=${this.pesCod} (cmn025/list) ──`);
        const pessoas = await this.listar('cmn025/list', { 'pesCod#EQ': this.pesCod }, 5);
        const pessoa = pessoas.find((p) => String(p.pesCod ?? '') === this.pesCod);
        if (!pessoa) {
            console.log('pessoa não encontrada');
            return;
        }
        const candidatos = Object.keys(pessoa).filter((k) => /cpf|cnpj|doc|cgc|insc/i.test(k));
        console.log(`campo em uso hoje (hipótese): ${CAMPO_DOCUMENTO_FAVORECIDO}`);
        for (const k of candidatos) {
            const digitos = String(pessoa[k] ?? '').replace(/\D/g, '');
            console.log(
                `  ${k}: ${this.mascarar(pessoa[k])} (${digitos.length} dígitos${digitos.length === 11 || digitos.length === 14 ? ' — parece CPF/CNPJ' : ''})`,
            );
        }
        if (candidatos.length === 0) console.log('  nenhum campo com nome de documento');
    };

    private itensDoLote = async (bncCod: number): Promise<void> => {
        const itens = await this.listar(
            `fin015/finItemSispag/list/${this.filCod}/${bncCod}/${this.flpCod}`,
            {},
            500,
        );
        const doFavorecido = itens.filter((i) => String(i.pesCod ?? '') === this.pesCod);
        console.log(`itens no lote: ${itens.length} · do favorecido: ${doFavorecido.length}`);
        for (const it of doFavorecido) {
            console.log({
                item: `${it.filCod}:${it.docCod}:${it.titCod}`,
                itsVldModalidade: it.itsVldModalidade, // H6
                fbtCod: it.fbtCod, // H7
                fbtDesDescr: it.fbtDesDescr,
                fbtEspCodbanco: it.fbtEspCodbanco,
                temPctCodSeq: this.cheio(it.pctCodSeq), // H3
                itsVldChavePix: it.itsVldChavePix, // H4
                itsDesChavePix: this.mascarar(it.itsDesChavePix),
                itsNumBanco: it.itsNumBanco,
                conta: this.mascarar(it.conta ?? it.pctEspNumContaBanc),
            });
        }
    };
}

const fil = Number(ProbeTedPixSupervisionado.argumento('fil'));
const flp = Number(ProbeTedPixSupervisionado.argumento('flp'));
const pes = ProbeTedPixSupervisionado.argumento('pes');
if (!Number.isInteger(fil) || !Number.isInteger(flp) || !pes) {
    console.error('uso: --fil <filCod> --flp <flpCod> --pes <pesCod>');
    process.exit(1);
}

new ProbeTedPixSupervisionado(fil, flp, pes)
    .run()
    .then(() => process.exit(0))
    .catch((e) => {
        // SÓ a mensagem: o erro axios cru carrega o corpo do login, com a senha.
        console.error('sonda falhou:', (e as Error).message);
        process.exit(1);
    });
