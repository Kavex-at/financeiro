import { redactBody } from './redact.js';

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

    // ── ADR-0030 §4 ──────────────────────────────────────────────────────────────────────
    it('masks the GoTrue service-role key in every spelling that occurs in practice', () => {
        // Ela IGNORA RLS e pode criar usuários — um `[REQ] body=` com ela no drain do Render
        // é equivalente a vazar o banco inteiro. Até esta feature, `redactBody` NÃO a cobria.
        const out = redactBody({
            service_role: 'eyJhbGciOi.service.role',
            serviceRoleKey: 'eyJhbGciOi.camel.case',
            SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOi.env.var',
            supabase: { service_role_key: 'eyJhbGciOi.nested' },
            url: 'https://ref.supabase.co',
        }) as Record<string, unknown>;

        expect(out.service_role).toBe('[REDACTED]');
        expect(out.serviceRoleKey).toBe('[REDACTED]');
        expect(out.SUPABASE_SERVICE_ROLE_KEY).toBe('[REDACTED]');
        expect((out.supabase as Record<string, unknown>).service_role_key).toBe('[REDACTED]');
        // A URL do projeto não é segredo — mascará-la só atrapalharia o diagnóstico.
        expect(out.url).toBe('https://ref.supabase.co');
    });
});
