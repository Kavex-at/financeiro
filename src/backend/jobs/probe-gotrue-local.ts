import bcrypt from 'bcryptjs';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';

/**
 * Sonda do spike T-1 (feature `auth-supabase`, ADR-0056): a API admin do GoTrue aceita
 * `password_hash` no create e no update? Também serve de fumaça para o roteiro de QA local.
 *
 * SEGURANÇA: roda SÓ contra o GoTrue de um `supabase start` local. Recusa qualquer
 * `SUPABASE_URL` que não seja `http://127.0.0.1:*` ou `http://localhost:*` — nunca toca o
 * projeto de produção. Não usa banco, não usa o `bootstrapAppContainer`, não lê `.env`.
 *
 * Cria usuários descartáveis `t1-probe-<carimbo>@probe.local` e os apaga ao final.
 *
 * Run (numa pasta temporária fora do repositório, com o stack local no ar):
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_PUBLISHABLE_KEY=<publishable/anon local> SUPABASE_SECRET_KEY=<secret/service_role local> \
 *   MAILPIT_URL=http://127.0.0.1:54324 npx tsx jobs/probe-gotrue-local.ts
 */
const URL_LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/;
const BCRYPT_ROUNDS = 12;
const REUSE_WINDOW_WAIT_MS = 11_000;

const baseUrl = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? '';
const secretKey = process.env.SUPABASE_SECRET_KEY ?? '';
const mailpitUrl = (process.env.MAILPIT_URL ?? '').replace(/\/$/, '');

if (!URL_LOCAL.test(baseUrl)) {
    console.error(
        'RECUSADO: SUPABASE_URL precisa ser um GoTrue LOCAL (http://127.0.0.1:* ou ' +
            'http://localhost:*). Esta sonda nunca roda contra um projeto real.',
    );
    process.exit(1);
}
if (publishableKey === '' || secretKey === '') {
    console.error(
        'RECUSADO: defina SUPABASE_PUBLISHABLE_KEY e SUPABASE_SECRET_KEY (do stack local).',
    );
    process.exit(1);
}

const auth = `${baseUrl}/auth/v1`;
const vereditos: string[] = [];

const veredito = (n: string, ok: boolean, detalhe: string): void => {
    const linha = `[T-1] ${n} ${ok ? 'OK   ' : 'FALHA'} ${detalhe}`;
    vereditos.push(linha);
    console.log(linha);
};

interface Resposta {
    status: number;
    body: Record<string, unknown>;
}

const chamar = async (
    metodo: string,
    caminho: string,
    headers: Record<string, string>,
    corpo?: unknown,
): Promise<Resposta> => {
    const res = await fetch(`${auth}${caminho}`, {
        method: metodo,
        headers: { 'content-type': 'application/json', ...headers },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await res.text();
    let body: Record<string, unknown> = {};
    try {
        body = texto === '' ? {} : (JSON.parse(texto) as Record<string, unknown>);
    } catch {
        body = { raw: texto.slice(0, 200) };
    }
    return { status: res.status, body };
};

const publico = { apikey: publishableKey };
const admin = { apikey: secretKey, authorization: `Bearer ${secretKey}` };

const resumoErro = (r: Resposta): string =>
    `status=${r.status} error_code=${String(r.body.error_code ?? r.body.error ?? '-')} ` +
    `msg=${String(r.body.msg ?? r.body.message ?? r.body.error_description ?? '-').slice(0, 120)}`;

const login = (email: string, password: string): Promise<Resposta> =>
    chamar('POST', '/token?grant_type=password', publico, { email, password });

const refresh = (refreshToken: string): Promise<Resposta> =>
    chamar('POST', '/token?grant_type=refresh_token', publico, { refresh_token: refreshToken });

const contarEmails = async (): Promise<number | undefined> => {
    if (mailpitUrl === '') {
        return undefined;
    }
    const res = await fetch(`${mailpitUrl}/api/v1/messages`);
    const body = (await res.json()) as { total?: number; messages_count?: number };
    return body.total ?? body.messages_count;
};

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const chaves = (r: Resposta): string => Object.keys(r.body).sort().join(',');

interface Contexto {
    userId: string;
    email: string;
    senha: string;
}

const passoCabecalhos = async (): Promise<void> => {
    const caminho = '/admin/users?page=1&per_page=1';
    const soApikey = await chamar('GET', caminho, { apikey: secretKey });
    const soBearer = await chamar('GET', caminho, { authorization: `Bearer ${secretKey}` });
    const ambos = await chamar('GET', caminho, admin);
    const pubNoAdmin = await chamar('GET', caminho, publico);
    const tipo = secretKey.startsWith('sb_secret_') ? 'sb_secret_' : 'legada (JWT)';
    veredito(
        '9',
        ambos.status === 200,
        `admin com chave ${tipo}: só apikey=${soApikey.status}, só Bearer=${soBearer.status}, ` +
            `apikey+Bearer=${ambos.status}, publicável=${pubNoAdmin.status}; lista: ${chaves(ambos)}`,
    );
};

const passoCreate = async (email: string, senha: string): Promise<Contexto> => {
    const hash = await bcrypt.hash(senha, BCRYPT_ROUNDS);
    const criado = await chamar('POST', '/admin/users', admin, {
        email,
        password_hash: hash,
        email_confirm: true,
    });
    const userId = String(criado.body.id ?? '');
    veredito(
        '1',
        criado.status === 200 && userId !== '',
        `POST /admin/users { password_hash: ${hash.slice(0, 7)}… } → ${criado.status}; ` +
            `email_confirmed_at=${String(criado.body.email_confirmed_at ?? '-')}; chaves: ${chaves(criado)}`,
    );
    const repetido = await chamar('POST', '/admin/users', admin, {
        email,
        password_hash: hash,
        email_confirm: true,
    });
    console.log(`[T-1] create com e-mail repetido → ${resumoErro(repetido)}`);

    const l1 = await login(email, senha);
    veredito(
        '2',
        l1.status === 200 && typeof l1.body.access_token === 'string',
        `login com a senha original → ${l1.status}; chaves: ${chaves(l1)}`,
    );
    console.log(`[T-1] senha errada → ${resumoErro(await login(email, 'senha-errada'))}`);
    console.log(`[T-1] inexistente → ${resumoErro(await login(`x-${email}`, senha))}`);
    return { userId, email, senha };
};

const passoUpdateSenha = async (ctx: Contexto): Promise<Contexto> => {
    // 3a) password_hash no update.
    const senhaHash = 'Senha-via-hash-456';
    const hash = await bcrypt.hash(senhaHash, BCRYPT_ROUNDS);
    const up = await chamar('PUT', `/admin/users/${ctx.userId}`, admin, { password_hash: hash });
    const novaHash = await login(ctx.email, senhaHash);
    const antigaHash = await login(ctx.email, ctx.senha);
    const hashAceito = up.status === 200 && novaHash.status === 200 && antigaHash.status !== 200;
    veredito(
        '3',
        hashAceito,
        `PUT { password_hash } → ${up.status}; nova senha → ${novaHash.status}; ` +
            `antiga → ${antigaHash.status}${hashAceito ? '' : ' (IGNORADO em silêncio: 200 sem efeito)'}`,
    );
    if (hashAceito) {
        return { ...ctx, senha: senhaHash };
    }
    // 3b) fallback: password em claro no update.
    const senhaClara = 'Senha-em-claro-789';
    const upClaro = await chamar('PUT', `/admin/users/${ctx.userId}`, admin, {
        password: senhaClara,
    });
    const novaClara = await login(ctx.email, senhaClara);
    const antigaClara = await login(ctx.email, ctx.senha);
    veredito(
        '3b',
        upClaro.status === 200 && novaClara.status === 200 && antigaClara.status !== 200,
        `fallback PUT { password } → ${upClaro.status}; nova → ${novaClara.status}; ` +
            `antiga → ${antigaClara.status}`,
    );
    return { ...ctx, senha: senhaClara };
};

const passoEmail = async (ctx: Contexto): Promise<Contexto> => {
    const email2 = ctx.email.replace('@', '-b@');
    const antes = await contarEmails();
    const troca = await chamar('PUT', `/admin/users/${ctx.userId}`, admin, {
        email: email2,
        email_confirm: true,
    });
    const depois = await contarEmails();
    const comNovo = await login(email2, ctx.senha);
    const comAntigo = await login(ctx.email, ctx.senha);
    veredito(
        '4',
        troca.status === 200 &&
            comNovo.status === 200 &&
            comAntigo.status !== 200 &&
            antes === depois,
        `PUT { email, email_confirm } → ${troca.status} (email=${String(troca.body.email)}); ` +
            `login novo → ${comNovo.status}; antigo → ${comAntigo.status}; ` +
            `mailpit antes=${String(antes)} depois=${String(depois)}`,
    );
    return { ...ctx, email: email2 };
};

const passoBan = async (ctx: Contexto): Promise<void> => {
    const sessao = await login(ctx.email, ctx.senha);
    const url = `/admin/users/${ctx.userId}`;
    const ban = await chamar('PUT', url, admin, { ban_duration: '876000h' });
    const loginBanido = await login(ctx.email, ctx.senha);
    const refreshBanido = await refresh(String(sessao.body.refresh_token));
    const get = await chamar('GET', url, admin);
    const unban = await chamar('PUT', url, admin, { ban_duration: 'none' });
    const loginDepois = await login(ctx.email, ctx.senha);
    const getDepois = await chamar('GET', url, admin);
    veredito(
        '5',
        ban.status === 200 &&
            loginBanido.status !== 200 &&
            refreshBanido.status !== 200 &&
            unban.status === 200 &&
            loginDepois.status === 200,
        `ban → ${ban.status} (banned_until=${String(get.body.banned_until)}); login banido → ` +
            `${resumoErro(loginBanido)}; refresh banido → ${resumoErro(refreshBanido)}; desban → ` +
            `${unban.status} (banned_until=${String(getDepois.body.banned_until)}); ` +
            `login → ${loginDepois.status}`,
    );
};

const passoLogout = async (ctx: Contexto): Promise<void> => {
    const sessao = await login(ctx.email, ctx.senha);
    const lo = await chamar('POST', '/logout?scope=local', {
        ...publico,
        authorization: `Bearer ${String(sessao.body.access_token)}`,
    });
    const depois = await refresh(String(sessao.body.refresh_token));
    const outra = await login(ctx.email, ctx.senha);
    const outraRefresh = await refresh(String(outra.body.refresh_token));
    veredito(
        '6',
        (lo.status === 204 || lo.status === 200) &&
            depois.status !== 200 &&
            outraRefresh.status === 200,
        `logout → ${lo.status}; refresh da sessão encerrada → ${resumoErro(depois)}; ` +
            `outra sessão continua renovando → ${outraRefresh.status}`,
    );
};

const passoReuso = async (ctx: Contexto): Promise<string> => {
    // 7a) Uma geração atrás (o pai do token ativo): o GoTrue tolera mesmo fora da janela e
    // devolve o token ativo — é o "cliente perdeu a resposta do refresh".
    const s = await login(ctx.email, ctx.senha);
    const g1 = await refresh(String(s.body.refresh_token));
    await esperar(REUSE_WINDOW_WAIT_MS);
    const paiForaDaJanela = await refresh(String(s.body.refresh_token));
    const mesmoAtivo = paiForaDaJanela.body.refresh_token === g1.body.refresh_token;
    // 7b) Duas gerações atrás, fora da janela: detecção de reuso derruba a sessão inteira.
    const g2 = await refresh(String(g1.body.refresh_token));
    const g3 = await refresh(String(g2.body.refresh_token));
    await esperar(REUSE_WINDOW_WAIT_MS);
    const avo = await refresh(String(g1.body.refresh_token));
    const legitimo = await refresh(String(g3.body.refresh_token));
    veredito(
        '7',
        // O que o D12 precisa saber: reuso de token já rotacionado é recusado. Se a sessão
        // inteira cai junto (revogação da família) depende da versão: registrado no detalhe.
        g1.status === 200 && avo.status !== 200,
        `refresh → ${g1.status} (chaves: ${chaves(g1)}); pai do ativo após ` +
            `${REUSE_WINDOW_WAIT_MS / 1000}s → ${paiForaDaJanela.status} (devolve o ativo: ` +
            `${mesmoAtivo}); avô após ${REUSE_WINDOW_WAIT_MS / 1000}s → ${resumoErro(avo)}; ` +
            `token ativo depois do reuso → ${resumoErro(legitimo)}`,
    );
    return String(s.body.access_token);
};

const passoJwks = async (token: string): Promise<void> => {
    const header = decodeProtectedHeader(token);
    const jwks = createRemoteJWKSet(new URL(`${auth}/.well-known/jwks.json`));
    try {
        const { payload } = await jwtVerify(token, jwks, {
            algorithms: ['ES256'],
            issuer: auth,
            audience: 'authenticated',
        });
        veredito(
            '8',
            header.alg === 'ES256' &&
                payload.role === 'authenticated' &&
                payload.is_anonymous !== true,
            `alg=${String(header.alg)} iss=${String(payload.iss)} aud=${String(payload.aud)} ` +
                `role=${String(payload.role)} is_anonymous=${String(payload.is_anonymous)} ` +
                `exp-iat=${Number(payload.exp) - Number(payload.iat)}s ` +
                `claims=${Object.keys(payload).sort().join(',')}`,
        );
    } catch (error) {
        veredito(
            '8',
            false,
            `verificação falhou: ${(error as Error).message} (alg=${String(header.alg)})`,
        );
    }
};

const main = async (): Promise<void> => {
    const health = await chamar('GET', '/health', publico);
    console.log(`[T-1] GoTrue local: ${String(health.body.version)} (${baseUrl})`);
    await passoCabecalhos();
    let ctx = await passoCreate(`t1-probe-${Date.now()}@probe.local`, 'Senha-original-123');
    try {
        ctx = await passoUpdateSenha(ctx);
        ctx = await passoEmail(ctx);
        await passoBan(ctx);
        await passoLogout(ctx);
        await passoJwks(await passoReuso(ctx));
    } finally {
        const del = await chamar('DELETE', `/admin/users/${ctx.userId}`, admin);
        console.log(`[T-1] limpeza: DELETE /admin/users/<id> → ${del.status}`);
    }
    console.log('\n[T-1] RESUMO');
    for (const linha of vereditos) {
        console.log(linha);
    }
    // O passo 3 (password_hash no update) é um achado, não uma falha da sonda: o 3b decide.
    const falhas = vereditos.filter((l) => l.includes('FALHA') && !l.startsWith('[T-1] 3 '));
    process.exit(falhas.length > 0 ? 1 : 0);
};

main().catch((error) => {
    console.error('[T-1] sonda falhou:', error instanceof Error ? error.message : String(error));
    process.exit(1);
});
