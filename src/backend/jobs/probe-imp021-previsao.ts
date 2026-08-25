import 'reflect-metadata';
import 'dotenv/config';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ProcessoProviderConexos from '../domain/service/recebimentos/ProcessoProviderConexos.js';
import { previsaoNdeDoProcesso } from '../domain/interface/recebimentos/constants.js';

/** Sonda READ-ONLY: repete a cadeia provider → rota para um pesCod/filial. */
const FIL = Number(process.env.FIL ?? '2');
const PES = Number(process.env.PES ?? '191');
const PRI = Number(process.env.PRI ?? '3577');

const main = async () => {
    await bootstrapAppContainer();
    const provider = container.resolve(ProcessoProviderConexos);
    const processos = await provider.listCandidatosParaTransacao({ filCod: FIL, pesCod: PES });
    console.log(`processos=${processos.length}`);
    const alvo = processos.find((p) => p.priCod === PRI);
    console.log('alvo:', JSON.stringify(alvo));
    console.log('previsaoNde:', JSON.stringify(previsaoNdeDoProcesso(alvo?.priVldTipo)));
    const semTipo = processos.filter((p) => p.priVldTipo === undefined).length;
    console.log(`sem priVldTipo: ${semTipo}/${processos.length}`);
};

main().then(
    () => process.exit(0),
    (e) => {
        console.error(e);
        process.exit(1);
    },
);
