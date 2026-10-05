-- 0074 — segundo papel da plataforma: `Analista` (ADR-0053, Q4: pacotes mudam só por migration de dados).
--
-- Só dado: o catálogo de permissões e os `CHECK` das tabelas não mudam. O papel nasce com as três
-- frentes em leitura e escrita, EXCETO o SISPAG, que fica só em `sispag:ver` (sem `sispag:executar`:
-- montar lote, gerar remessa e demais escritas do SISPAG continuam com quem tem o papel
-- Administrador ou uma exceção por usuário `conceder`). Também fora do pacote, de propósito:
-- `sispag:aprovar_destino`, `operacao:ver`, `metricas:ver` e `usuarios:gerenciar`. Quem precisar de
-- algum deles recebe como exceção por usuário (Q2), com trilha em `app_user_access_event`.
--
-- Nenhum usuário muda de papel aqui; a atribuição é feita na tela de Usuários.
--
-- Idempotente: `ON CONFLICT DO NOTHING` nas duas tabelas. Rodar de novo não duplica nem mexe num
-- pacote ajustado depois. Sem reverse: nada é destrutivo, e remover o papel falharia (ou deixaria
-- usuários sem papel, `role_id NOT NULL`) assim que alguém o tivesse.

INSERT INTO app_role (nome, descricao)
VALUES (
    'Analista',
    'Permutas e Recebimentos com escrita; SISPAG somente leitura (sem montar lote nem gerar remessa).'
)
ON CONFLICT (lower(nome)) DO NOTHING;

INSERT INTO app_role_permission (role_id, permission)
SELECT r.id, p.permission
  FROM app_role r
 CROSS JOIN (VALUES
        ('permutas:ver'), ('permutas:executar'),
        ('sispag:ver'),
        ('recebimentos:ver'), ('recebimentos:executar')
     ) AS p(permission)
 WHERE lower(r.nome) = 'analista'
ON CONFLICT DO NOTHING;
