import { redactBody, redactErrorMessage } from './redact.js';

describe('redactBody', () => {
    it('masks sensitive top-level keys (case-insensitive)', () => {
        const out = redactBody({ username: 'simone', password: 'segredo', Token: 'abc' }) as Record<
            string,
            unknown
        >;
        expect(out.username).toBe('simone');
        expect(out.password).toBe('[REDACTED]');
        expect(out.Token).toBe('[REDACTED]');
    });

    it('masks nested sensitive keys (objects and arrays)', () => {
        const out = redactBody({
            user: { name: 'x', secret: 's' },
            items: [{ apiKey: 'k1' }, { apiKey: 'k2' }],
        }) as Record<string, unknown>;
        expect((out.user as Record<string, unknown>).name).toBe('x');
        expect((out.user as Record<string, unknown>).secret).toBe('[REDACTED]');
        const items = out.items as Array<Record<string, unknown>>;
        expect(items[0].apiKey).toBe('[REDACTED]');
        expect(items[1].apiKey).toBe('[REDACTED]');
    });

    it('does not mutate the original object', () => {
        const original = { password: 'p' };
        redactBody(original);
        expect(original.password).toBe('p');
    });

    it('leaves non-sensitive payloads untouched', () => {
        const out = redactBody({ docCod: '2731', valorAlocado: 1000 });
        expect(out).toEqual({ docCod: '2731', valorAlocado: 1000 });
    });

    it('passes through primitives and null', () => {
        expect(redactBody('hello')).toBe('hello');
        expect(redactBody(42)).toBe(42);
        expect(redactBody(null)).toBe(null);
    });

    it('accepts custom key list', () => {
        const out = redactBody({ cpf: '123', nome: 'x' }, ['cpf']) as Record<string, unknown>;
        expect(out.cpf).toBe('[REDACTED]');
        expect(out.nome).toBe('x');
    });
});

describe('redactErrorMessage — mensagem de erro livre (ADR-0042)', () => {
    it('redige connection string com credencial embutida', () => {
        const r = redactErrorMessage(
            'connection to postgresql://financeiro:s3nh4Secreta@db.host:5432/fin failed',
        );
        expect(r).not.toContain('s3nh4Secreta');
        expect(r).toContain('[REDACTED_URL]@');
    });

    it('redige o usuário citado pelo Postgres', () => {
        const r = redactErrorMessage('password authentication failed for user "financeiro"');
        expect(r).not.toContain('"financeiro"');
        expect(r).toContain('for user "[REDACTED]"');
    });

    /**
     * Card `security-2`. Não é credencial, mas entrega o desenho da rede interna a quem lê o
     * drain de logs do Render — que sai do perímetro do processo. São exatamente os dois
     * formatos que o `pg`/Node emitem quando o pooler do Supabase cai, e é esse caminho que o
     * `conexosSessionStore` passou a logar.
     */
    it('redige IP e porta de erro de conexão (topologia interna)', () => {
        const r = redactErrorMessage('connect ECONNREFUSED 10.0.0.5:5432');
        expect(r).not.toContain('10.0.0.5');
        expect(r).toContain('ECONNREFUSED [REDACTED_HOST]');
    });

    it('redige o hostname do pooler em ENOTFOUND', () => {
        const r = redactErrorMessage('getaddrinfo ENOTFOUND aws-0-sa-east-1.pooler.supabase.com');
        expect(r).not.toContain('supabase.com');
        expect(r).toContain('ENOTFOUND [REDACTED_HOST]');
    });

    it('redige ETIMEDOUT/EHOSTUNREACH com IP', () => {
        expect(redactErrorMessage('connect ETIMEDOUT 172.16.0.9:6543')).not.toContain('172.16.0.9');
        expect(redactErrorMessage('EHOSTUNREACH 192.168.1.1')).not.toContain('192.168.1.1');
    });

    it('redige password=/token=/secret= em texto livre', () => {
        for (const entrada of ['password=abc123', 'token: eyJhbGciOi', 'api_key=xyz']) {
            expect(redactErrorMessage(`falhou com ${entrada}`)).toContain('[REDACTED]');
        }
    });

    it('redige cookie de sessão do Conexos', () => {
        const r = redactErrorMessage('request failed; Cookie: sid=AbCdEf123456');
        expect(r).not.toContain('AbCdEf123456');
    });

    it('redige Bearer token', () => {
        const r = redactErrorMessage('401 with Authorization Bearer eyJhbGciOiJIUzI1NiJ9');
        expect(r).not.toContain('eyJhbGciOiJIUzI1NiJ9');
        expect(r).toContain('Bearer [REDACTED]');
    });

    it('redige blocos longos de base64/hex soltos', () => {
        const chave = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5';
        expect(redactErrorMessage(`key ${chave} rejected`)).not.toContain(chave);
    });

    it('PRESERVA a mensagem útil quando não há nada sensível', () => {
        const m = 'Conexos call to fin010 failed: Generic.ERROR_MESSAGE';
        expect(redactErrorMessage(m)).toBe(m);
    });

    it('não estraga um UUID nem um docCod (não são segredo)', () => {
        const m = 'run 3f7c1b2e-9a44-4c0d-8e1f-2b6d5a0c9e77 falhou no docCod 18337';
        expect(redactErrorMessage(m)).toBe(m);
    });

    it('trunca mensagem gigante — ruído no painel e no banco', () => {
        // Texto realista (palavras separadas), senão a regra de base64 come a string inteira
        // antes de o truncamento ter o que cortar.
        const r = redactErrorMessage('falha na filial 4 durante a leitura do grid; '.repeat(30));
        expect(r.length).toBeLessThan(560);
        expect(r).toContain('[truncado]');
    });

    it('uma corrida longa de alfanuméricos é redigida — over-redact é o lado seguro', () => {
        // Documenta a escolha: 32+ chars sem separador quase nunca é prosa, e deixar passar um
        // token não tem conserto depois de gravado.
        expect(redactErrorMessage(`id ${'a'.repeat(40)} invalido`)).toContain('[REDACTED]');
    });
});
