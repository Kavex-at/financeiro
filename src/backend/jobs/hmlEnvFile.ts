import { readFileSync } from 'node:fs';

/**
 * Carrega credenciais de HML de um ARQUIVO PRIVADO (`HML_ENV_FILE`), antes de qualquer outro
 * import — o singleton do Conexos lê `CONEXOS_USERNAME`/`CONEXOS_PASSWORD` na construção.
 *
 * Existe porque o usuário de produção (CLONEX) é recusado em HML (`Bad Credentials`): a
 * credencial de HML é outra e não deve passar por linha de comando, `.env` do repositório nem
 * pelo transcript. O arquivo tem linhas `CHAVE=valor`; só estas chaves são lidas.
 *
 * Recusa se a base apontada não for HML: este módulo nunca deve levar uma credencial de HML para
 * outro ambiente, nem o contrário.
 */
const ARQUIVO = process.env.HML_ENV_FILE;
if (ARQUIVO) {
    const base = process.env.CONEXOS_BASE_URL ?? '';
    if (!base.includes('-hml')) {
        console.error(`RECUSADO: HML_ENV_FILE só vale com base HML. Base atual: ${base}`);
        process.exit(1);
    }
    const PERMITIDAS = new Set(['CONEXOS_USERNAME', 'CONEXOS_PASSWORD']);
    for (const linha of readFileSync(ARQUIVO, 'utf8').split('\n')) {
        const m = linha.match(/^([A-Z_]+)=(.*)$/);
        if (m?.[1] && PERMITIDAS.has(m[1])) process.env[m[1]] = (m[2] ?? '').trim();
    }
}
