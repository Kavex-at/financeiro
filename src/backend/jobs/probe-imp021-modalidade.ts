import 'reflect-metadata';
import { config } from 'dotenv';
config({ path: process.env.PROBE_ENV_PATH ?? '.env' });

import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/**
 * Sonda READ-ONLY do `imp021/list` — por que `priVldTipo` volta vazio?
 * Só POST em `imp021/list` (grid paginado). Nenhuma escrita.
 */
const PRI = process.env.PRI ?? '3577';
const FIL = Number(process.env.FIL ?? '2');
const PES = process.env.PES;

const FIELD_LIST = [
    'priCod',
    'pesCod',
    'priEspRefcliente',
    'priVldTipo',
    'dpeNomPessoa',
    'priDtaAbertura',
    'filCod',
];

const main = async () => {
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    await base.ensureSid();

    const call = async (label: string, body: Record<string, unknown>) => {
        const rows = await base.paginate<Record<string, unknown>>({
            endpoint: 'imp021/list',
            bodyBase: body,
            opts: { filCod: FIL },
        });
        const hit = rows.find((r) => String(r.priCod) === PRI) ?? rows[0];
        console.log(`\n=== ${label} — ${rows.length} linha(s)`);
        if (!hit) return;
        console.log('keys:', Object.keys(hit).join(','));
        console.log(
            'priCod=%s pesCod=%s priVldTipo=%o (%s) priVldStatus=%o',
            hit.priCod,
            hit.pesCod,
            hit.priVldTipo,
            typeof hit.priVldTipo,
            hit.priVldStatus,
        );
        const tipoish = Object.entries(hit).filter(
            ([k, v]) => /tipo|ungCod|ungDes|impexp/i.test(k) && v !== null && v !== '',
        );
        console.log('campos tipo-ish:', JSON.stringify(tipoish));
    };

    // A. caminho do gate 0.5 — filtro por priCod, fieldList explícito
    await call('A priCod#IN + fieldList explícito', {
        fieldList: FIELD_LIST,
        filterList: { 'priCod#IN': [PRI] },
        serviceName: 'imp021',
    });

    // B. mesmo filtro, fieldList VAZIO (default do Conexos)
    await call('B priCod#IN + fieldList []', {
        fieldList: [],
        filterList: { 'priCod#IN': [PRI] },
        serviceName: 'imp021',
    });

    // C. caminho do modal — filtro por pesCod + status aberto
    if (PES) {
        await call('C pesCod#IN + priVldStatus 1 + fieldList explícito', {
            fieldList: FIELD_LIST,
            filterList: { 'pesCod#IN': [PES], 'priVldStatus#IN': ['1'] },
            serviceName: 'imp021',
            orderList: { orderList: [{ propertyName: 'priCod', order: 'asc' }] },
        });
    }
};

main().then(
    () => process.exit(0),
    (e) => {
        console.error(e);
        process.exit(1);
    },
);
