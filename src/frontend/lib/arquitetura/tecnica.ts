/**
 * Vista TÉCNICA — colunas por camada, da borda HTTP aos sistemas externos.
 *
 * Nós marcados com `estado: 'alvo'` só aparecem no recorte "Alvo" do toggle;
 * eles descrevem a arquitetura de destino (Lambda, Terraform, multi-tenant)
 * declarada no CLAUDE.md e que hoje não existe.
 *
 * Contagens conferidas contra a `main` em 2026-09-29 (v0.44.0).
 */

import type { ArqEdge, ArqNode } from './types'

const X_JOB = 40
const X_UI = 40
const X_EDGE = 350
const X_ROTA = 660
const X_SERVICO = 970
const X_REPO = 1300
const X_CLIENTE = 1620
const X_EXTERNO = 1960

export const TECNICA_NODES: ArqNode[] = [
    // ─────────────────────────────── Jobs / cron ───────────────────────────────
    {
        id: 'tec-actions',
        position: { x: X_JOB, y: -260 },
        data: {
            label: 'GitHub Actions (cron)',
            subtitle: '6 workflows agendados',
            frente: 'plataforma',
            camada: 'job',
            maturidade: 'implementado',
            estado: 'hoje',
            vista: 'tecnica',
            descricao:
                'A cadência das frentes roda aqui, e não no servidor de aplicação: ingestão de permutas (06h, 12h e 18h BRT), carteira do SISPAG seguida da formação de lotes (07h), extrato de recebimentos (toda hora, :20), reconciliação de NDe com a SEFAZ (toda hora, :35), detector de pipeline parado (toda hora, :45) e vigia de execuções presas do SISPAG (a cada 15 min). Os minutos são escalonados para não disputar as poucas sessões simultâneas que o ERP aceita. Cada execução aplica as migrações antes do job, grava seu próprio registro de execução e, se falhar, dispara um alerta.',
            arquivos: [
                '.github/workflows/ingest-permutas.yml',
                '.github/workflows/ingest-sispag.yml',
                '.github/workflows/ingest-extratos.yml',
                '.github/workflows/reconciliar-nde.yml',
                '.github/workflows/detect-staleness.yml',
                '.github/workflows/reaper-sispag.yml',
            ],
            riscos: [
                {
                    nivel: 'medio',
                    texto:
                        'O detector de pipeline parado roda no mesmo GitHub Actions que vigia. Se o próprio Actions deixar de disparar, ninguém é avisado — não há verificação externa de "sinal de vida".',
                    origem: 'ADR-0042',
                },
                {
                    nivel: 'medio',
                    texto:
                        'Os crons têm credencial do ERP própria, separada da do servidor. Se ficar desatualizada, a execução que lê zero títulos ainda aparece como sucesso.',
                },
            ],
        },
    },
    {
        id: 'tec-eventbridge',
        position: { x: X_JOB, y: -260 },
        data: {
            label: 'EventBridge + Lambda job',
            subtitle: 'Scheduler gerenciado',
            frente: 'plataforma',
            camada: 'job',
            maturidade: 'planejado',
            estado: 'alvo',
            vista: 'tecnica',
            descricao:
                'No estado-alvo a cadência passa a um agendador gerenciado na conta do cliente, com retentativa, fila de mensagens mortas e alarme nativo — e o monitoramento deixa de depender do mesmo serviço que executa os jobs.',
            docRefs: ['ontology/_inbox/migration-debt.md'],
        },
    },

    // ─────────────────────────────────── UI ────────────────────────────────────
    {
        id: 'tec-frontend',
        position: { x: X_UI, y: 0 },
        data: {
            label: 'Next.js 16 (App Router)',
            subtitle: 'Vercel · 11 telas',
            frente: 'plataforma',
            camada: 'ui',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Aplicação React 19 com App Router, Tailwind 4 e componentes shadcn/ui dentro do repositório. Telas: início, login, permutas (com borderôs e clientes-filtro), SISPAG, recebimentos, operação, métricas, usuários e esta página. Sem biblioteca de cache de dados: fetch direto com hooks próprios. A integração contínua roda typecheck, lint, testes e build a cada push, e o deploy é automático.',
            arquivos: [
                'src/frontend/app/permutas/page.tsx',
                'src/frontend/app/sispag/page.tsx',
                'src/frontend/app/recebimentos/page.tsx',
                'src/frontend/app/operacao/page.tsx',
                'src/frontend/lib/api.ts',
            ],
            riscos: [
                {
                    nivel: 'medio',
                    texto:
                        'Os limites de cobertura do frontend continuam baixos (linhas 33%, ramos 23%). A tela de permutas caiu de mais de duas mil para cerca de mil linhas, mas segue a maior do app.',
                    origem: 'src/frontend/jest.config.js',
                },
            ],
        },
    },
    {
        id: 'tec-auth-front',
        position: { x: X_UI, y: 230 },
        data: {
            label: 'Sessão no navegador',
            subtitle: 'JWT em localStorage · 12h',
            frente: 'plataforma',
            camada: 'ui',
            maturidade: 'parcial',
            estado: 'hoje',
            vista: 'tecnica',
            descricao:
                'Login com o e-mail da Columbia (ou usuário); o token é guardado no armazenamento local do navegador e enviado como cabeçalho de autorização. O token não carrega permissões: a tela pergunta ao servidor o que o usuário pode ver e executar, e esconde botões e rotas conforme isso. Não há verificação na borda do Next antes da página chegar ao navegador — quem protege de fato é o servidor.',
            arquivos: [
                'src/frontend/lib/auth/token.ts',
                'src/frontend/lib/auth/PermissoesProvider.tsx',
                'src/frontend/components/auth/RouteGate.tsx',
                'src/frontend/components/auth/ExigePermissao.tsx',
            ],
            riscos: [
                {
                    nivel: 'medio',
                    texto:
                        'Desativar um usuário derruba o acesso em até 30 segundos, mas um token vazado de usuário ativo vale até expirar (12 horas), e o armazenamento local é legível por qualquer script da página.',
                    origem: 'Regis-Review — security',
                },
            ],
            docRefs: ['ADR-0051 — login por e-mail real'],
        },
    },
    {
        id: 'tec-supabase-auth',
        position: { x: X_UI, y: 230 },
        data: {
            label: 'Supabase Auth',
            subtitle: 'Passo 3 da transição de login',
            frente: 'plataforma',
            camada: 'ui',
            maturidade: 'planejado',
            estado: 'alvo',
            vista: 'tecnica',
            descricao:
                'A transição de autenticação tem três passos: login pelo e-mail da Columbia (feito), permissões por módulo no banco (feito) e a troca do login próprio pela autenticação gerenciada do Supabase (a fazer). A biblioteca ainda não está instalada. A proposta comercial pede autenticação corporativa com controle por perfil como requisito transversal.',
            docRefs: [
                'ADR-0051 — login por e-mail real',
                'ADR-0053 — permissões por módulo no banco',
            ],
        },
    },

    // ────────────────────────────── Borda HTTP ─────────────────────────────────
    {
        id: 'tec-express',
        position: { x: X_EDGE, y: 0 },
        data: {
            label: 'Express 5',
            subtitle: 'Render · deploy automático',
            frente: 'plataforma',
            camada: 'edge',
            maturidade: 'implementado',
            estado: 'hoje',
            vista: 'tecnica',
            descricao:
                'O servidor de aplicação. Middlewares em ordem: CORS, limite global de requisições, identificador de requisição, log (com o corpo mascarado), autenticação, resolução de acesso, identidade no ERP e limite reforçado nas rotas pesadas; SISPAG e recebimentos têm uma porteira que os desliga sem redeploy. Na subida, aplica as migrações pendentes antes de aceitar tráfego e diagnostica a configuração sem nunca imprimir segredos. No desligamento, a rota de saúde responde 503 enquanto as requisições em curso terminam.',
            arquivos: [
                'src/backend/index.ts',
                'src/backend/http/buildApp.ts',
                'src/backend/http/bootstrap.ts',
                'src/backend/http/authEnv.ts',
                'render.yaml',
            ],
            riscos: [
                {
                    nivel: 'medio',
                    texto:
                        'Os logs de requisição continuam indo só para a saída padrão do Render, sem retenção nem busca.',
                    origem: 'ADR-0042',
                },
            ],
        },
    },
    {
        id: 'tec-apigw',
        position: { x: X_EDGE, y: 0 },
        data: {
            label: 'API Gateway + Lambda',
            subtitle: 'Uma conta por cliente',
            frente: 'plataforma',
            camada: 'edge',
            maturidade: 'planejado',
            estado: 'alvo',
            vista: 'tecnica',
            descricao:
                'A borda do estado-alvo. Cada rota vira uma função isolada, embrulhada por um handler que já cuida de log, metadados e tratamento de erro. Esse handler já existe no repositório — apenas sem importador, porque o runtime ainda é o servidor Express.',
            arquivos: ['src/backend/domain/libs/handler/ApiGatewayHandler.ts'],
            docRefs: ['ontology/_inbox/migration-debt.md — B1'],
        },
    },
    {
        id: 'tec-acesso',
        position: { x: X_EDGE, y: 230 },
        data: {
            label: 'Controle de acesso',
            subtitle: '9 permissões por módulo',
            frente: 'plataforma',
            camada: 'edge',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'A cada requisição, o servidor resolve usuário → papel → permissões a partir do banco (com cache de 30 segundos) e cada rota declara a permissão que exige: ver ou executar em permutas, SISPAG e recebimentos, mais operação, métricas e gestão de usuários. Um teste garante que nenhuma rota fica sem guarda.',
            arquivos: [
                'src/backend/http/acesso.ts',
                'src/backend/domain/interface/auth/Permission.ts',
                'src/backend/domain/service/auth/AccessService.ts',
                'src/backend/http/routePermissions.test.ts',
            ],
            riscos: [
                {
                    nivel: 'medio',
                    texto:
                        'Ainda não há restrição por filial: qualquer usuário com permissão de executar opera todas as filiais. O ponto de verificação existe, mas não há cadastro de filiais por usuário.',
                    origem: 'src/backend/http/filialAuthz.ts',
                },
            ],
            docRefs: ['ADR-0053 — permissões por módulo no banco'],
        },
    },
    {
        id: 'tec-handler-orfao',
        position: { x: X_EDGE, y: 470 },
        data: {
            label: 'Código pronto para o alvo',
            subtitle: 'Escrito, sem uso',
            frente: 'plataforma',
            camada: 'infra',
            maturidade: 'orfao',
            estado: 'hoje',
            vista: 'tecnica',
            descricao:
                'Três peças existem sem nenhum importador fora dos próprios testes: o handler de API Gateway, um relator de progresso por streaming que nenhuma rota conecta, e o cliente do Banco Central, cuja função migrou para um programa do ERP. São a ponte para o estado-alvo — e candidatos a remoção, se o alvo demorar.',
            arquivos: [
                'src/backend/domain/libs/handler/ApiGatewayHandler.ts',
                'src/backend/domain/libs/progress/SseProgressReporter.ts',
                'src/backend/domain/client/BcbClient.ts',
            ],
        },
    },

    // ─────────────────────────────── Rotas ─────────────────────────────────────
    {
        id: 'tec-rota-permutas',
        position: { x: X_ROTA, y: -120 },
        data: {
            label: 'Rotas de permutas',
            subtitle: '27 endpoints',
            frente: 'permutas',
            camada: 'rota',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Eleição, ingestão, painel, gestão, alocação, processamento da baixa, exceção manual, borderôs e relatórios — 17 exigem permissão de execução, 10 bastam ver. As mutações passam pelo limite reforçado de requisições. Erros do ERP são traduzidos por um interpretador dedicado antes de chegarem à tela.',
            arquivos: ['src/backend/routes/permutas.ts'],
            docRefs: ['ADR-0011 — endurecimento da API', 'ADR-0012 — escopo do limite de requisições'],
        },
    },
    {
        id: 'tec-rota-sispag',
        position: { x: X_ROTA, y: 70 },
        data: {
            label: 'Rotas de SISPAG',
            subtitle: '24 endpoints · atrás de flag',
            frente: 'sispag',
            camada: 'rota',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Painel, títulos, lotes e seu ciclo de vida, janela de data de débito, geração e download da remessa, linhas digitáveis, conciliação de retorno, boletos DDA e execuções. Tudo atrás de uma porteira que devolve acesso negado quando a frente não está habilitada. Erros de domínio viram códigos HTTP específicos, incluindo conflito de versão quando dois analistas mexem no mesmo lote.',
            arquivos: ['src/backend/routes/sispag.ts', 'src/backend/http/sispagGate.ts'],
        },
    },
    {
        id: 'tec-rota-recebimentos',
        position: { x: X_ROTA, y: 260 },
        data: {
            label: 'Rotas de recebimentos',
            subtitle: '15 endpoints · atrás de flag',
            frente: 'recebimentos',
            camada: 'rota',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Painel e enriquecimento, sincronização e upload de extrato, processos e SNs candidatos, execução da Solicitação de Numerário e aba de NDe. Uma flag de ambiente derruba todo o conjunto para acesso negado sem redeploy.',
            arquivos: ['src/backend/routes/recebimentos.ts'],
        },
    },
    {
        id: 'tec-rota-plataforma',
        position: { x: X_ROTA, y: 450 },
        data: {
            label: 'Rotas de plataforma',
            subtitle: 'acesso · operação · métricas',
            frente: 'plataforma',
            camada: 'rota',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Login e identidade, administração de usuários e papéis, painel de operação com reconhecimento de alertas, métricas do ciclo e saúde. A rota pública de saúde dos pipelines responde 503 quando algum está parado, pronta para um verificador externo.',
            arquivos: [
                'src/backend/routes/auth.ts',
                'src/backend/routes/usuarios.ts',
                'src/backend/routes/me.ts',
                'src/backend/routes/operacao.ts',
                'src/backend/routes/metricas.ts',
            ],
        },
    },

    // ────────────────────────────── Serviços ───────────────────────────────────
    {
        id: 'tec-svc-permutas',
        position: { x: X_SERVICO, y: -120 },
        data: {
            label: 'Serviços de permutas',
            subtitle: '17 classes',
            frente: 'permutas',
            camada: 'servico',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Eleição, elegibilidade, casamento e alocação, variação cambial, reconciliação (a baixa), gestão de borderô, exceção manual e relatórios. A ingestão funde chamadas simultâneas numa só, e a baixa roda sob trava por adiantamento.',
            arquivos: [
                'src/backend/domain/service/permutas/EleicaoPermutasService.ts',
                'src/backend/domain/service/permutas/ElegibilidadeService.ts',
                'src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts',
                'src/backend/domain/service/permutas/BorderoGestaoService.ts',
            ],
        },
    },
    {
        id: 'tec-svc-sispag',
        position: { x: X_SERVICO, y: 70 },
        data: {
            label: 'Serviços de SISPAG',
            subtitle: '10 classes',
            frente: 'sispag',
            camada: 'servico',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Ingestão da carteira, formação automática e ciclo de vida do lote, data de débito, geração da remessa com retomada, conciliação do retorno e boletos DDA. Concorrência entre analistas é resolvida por versão no registro; entre execuções, por trava no banco.',
            arquivos: [
                'src/backend/domain/service/sispag/LotePagamentoService.ts',
                'src/backend/domain/service/sispag/RemessaService.ts',
                'src/backend/domain/service/sispag/ConciliacaoRetornoService.ts',
                'src/backend/domain/service/sispag/BoletoDdaService.ts',
            ],
        },
    },
    {
        id: 'tec-svc-recebimentos',
        position: { x: X_SERVICO, y: 260 },
        data: {
            label: 'Serviços de recebimentos',
            subtitle: '23 classes + stubs',
            frente: 'recebimentos',
            camada: 'servico',
            maturidade: 'parcial',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Ingestão e importação do extrato, painel, provedor de processos, execução da Solicitação de Numerário (com o montador de payload e a decisão de contingência da NDe). A execução real da frente passa por esse caminho. O pipeline "completo" desenhado no início — casamento, rateio, regras, emissor de NDe e métricas — está ligado a stubs num contêiner próprio.',
            arquivos: [
                'src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts',
                'src/backend/domain/service/recebimentos/IngestaoTransacoesService.ts',
                'src/backend/domain/service/recebimentos/RecebimentosPainelService.ts',
                'src/backend/domain/recebimentosContainer.ts',
            ],
            docRefs: ['ADR-0045 — a spine real é o ledger de SN'],
        },
    },
    {
        id: 'tec-svc-plataforma',
        position: { x: X_SERVICO, y: 450 },
        data: {
            label: 'Operação, métricas e acesso',
            subtitle: '10 classes',
            frente: 'plataforma',
            camada: 'servico',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'O sistema relata a própria execução: cada job grava seu registro, o detector compara com o limite de atraso de cada pipeline (extratos 3h, permutas 18h, SISPAG 30h) e o serviço de notificação deduplica e grava o alerta, que aparece no painel de operação. As métricas do ciclo leem os ledgers de execução. Aqui também vivem a autenticação, o cálculo de permissões e a administração de usuários.',
            arquivos: [
                'src/backend/domain/service/operacao/StalenessDetector.ts',
                'src/backend/domain/service/operacao/NotificacaoService.ts',
                'src/backend/domain/service/operacao/ConfigDoctor.ts',
                'src/backend/domain/service/metricas/MetricasCicloService.ts',
                'src/backend/domain/service/auth/AccessService.ts',
            ],
            docRefs: [
                'ADR-0042 — o sistema relata a própria execução',
                'ADR-0045 / ADR-0052 — métricas do ciclo',
                'ontology/business-rules/staleness-por-pipeline.md',
            ],
        },
    },
    {
        id: 'tec-di',
        position: { x: X_SERVICO, y: 640 },
        data: {
            label: 'Injeção de dependências',
            subtitle: 'tsyringe · 3 contêineres',
            frente: 'plataforma',
            camada: 'infra',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Nada é instanciado diretamente: tudo é resolvido por contêiner — um principal, um de operação e um de recebimentos, que é onde as portas da Frente IV trocam stub por implementação real. O contêiner principal é compartilhado com os jobs, então nada que dependa da configuração completa do servidor pode ir nele. É a peça que já está no padrão do estado-alvo.',
            arquivos: [
                'src/backend/domain/appContainer.ts',
                'src/backend/domain/operacaoContainer.ts',
                'src/backend/domain/recebimentosContainer.ts',
            ],
        },
    },

    // ───────────────────────────── Repositórios ────────────────────────────────
    {
        id: 'tec-repos',
        position: { x: X_REPO, y: 20 },
        data: {
            label: 'Repositórios',
            subtitle: '27 classes · SQL parametrizado',
            frente: 'plataforma',
            camada: 'repositorio',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'A única porta para o banco, com SQL sempre parametrizado. Permutas (8), recebimentos (8), SISPAG (6), acesso (2), operação (2) e métricas (1). Uma suíte de integração contínua roda os repositórios contra um Postgres real.',
            arquivos: [
                'src/backend/domain/repository/permutas/',
                'src/backend/domain/repository/sispag/',
                'src/backend/domain/repository/recebimentos/',
            ],
        },
    },
    {
        id: 'tec-ledger',
        position: { x: X_REPO, y: 260 },
        data: {
            label: 'Ledgers de execução',
            subtitle: '4 ledgers · write-ahead',
            frente: 'plataforma',
            camada: 'repositorio',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Toda escrita no ERP é registrada antes da chamada, não depois: baixa de permuta, geração de remessa, conciliação de retorno e Solicitação de Numerário. Cada registro guarda a chave de idempotência, o que foi enviado, o que voltou, quem executou na plataforma e com qual usuário do ERP. É o que permite saber, após uma queda no meio, se a escrita aconteceu — e é também a fonte das métricas do ciclo.',
            arquivos: [
                'src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts',
                'src/backend/domain/repository/sispag/RemessaExecucaoRepository.ts',
                'src/backend/domain/repository/recebimentos/SolicitacaoNumerarioExecucaoRepository.ts',
                'ontology/business-rules/idempotencia-reconciliacao.md',
            ],
            docRefs: ['ADR-0041 — execução registra a identidade Conexos'],
        },
    },

    // ─────────────────────────────── Clientes ──────────────────────────────────
    {
        id: 'tec-conexos-client',
        position: { x: X_CLIENTE, y: -120 },
        data: {
            label: 'Cliente Conexos',
            subtitle: 'Base + 12 especializados',
            frente: 'plataforma',
            camada: 'cliente',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Um cliente base concentra paginação, retentativa e conversão de tipos; doze especializados o consomem, um por área do ERP — cadastro, financeiro, títulos, baixa, SISPAG (leitura, escrita e retorno), DDA, extrato, baixa de recebimento, geração de documento, NDe e NDe fiscal. As escritas irreversíveis são a exceção deliberada: não repetem em caso de falha de autenticação, porque repetir significaria escrita duplicada.',
            arquivos: [
                'src/backend/domain/client/ConexosBaseClient.ts',
                'src/backend/domain/client/ConexosBaixaClient.ts',
                'src/backend/domain/client/ConexosSispagWriteClient.ts',
                'src/backend/domain/client/ConexosNdeClient.ts',
            ],
        },
    },
    {
        id: 'tec-sessao',
        position: { x: X_CLIENTE, y: 100 },
        data: {
            label: 'Sessão do ERP',
            subtitle: 'Compartilhada · por usuário',
            frente: 'plataforma',
            camada: 'cliente',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Uma das partes mais sutis do sistema. O identificador de sessão do ERP é compartilhado entre processos numa tabela do banco, com controle de concorrência otimista e validade de vinte e cinco minutos. Quando o ERP recusa por excesso de sessões, a mais antiga é encerrada. As chamadas rodam sob as credenciais do próprio analista, guardadas cifradas, com queda para a conta de robô quando não há vínculo — e toda execução grava qual identidade foi usada de fato.',
            arquivos: [
                'src/backend/services/conexosSessionStore.ts',
                'src/backend/domain/client/ConexosSessionRegistry.ts',
                'src/backend/domain/client/ConexosSessionResolver.ts',
                'src/backend/domain/client/ConexosIdentityProvider.ts',
            ],
            riscos: [
                {
                    nivel: 'medio',
                    texto:
                        'A queda para o robô é silenciosa para o analista: a ação acontece, mas em nome do robô, que não tem todas as permissões do ERP.',
                    origem: 'ADR-0041',
                },
            ],
        },
    },
    {
        id: 'tec-db-client',
        position: { x: X_CLIENTE, y: 320 },
        data: {
            label: 'Cliente Postgres',
            subtitle: 'Pool · transação · trava',
            frente: 'plataforma',
            camada: 'cliente',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Pool de no máximo cinco conexões, com retentativa para falhas transitórias e travas cooperativas que serializam ingestões, baixas e remessas. Evita instruções preparadas nomeadas, por incompatibilidade com o modo de pooling usado.',
            arquivos: ['src/backend/domain/client/database/PostgreeDatabaseClient.ts'],
        },
    },
    {
        id: 'tec-nexxera-client',
        position: { x: X_CLIENTE, y: 640 },
        data: {
            label: 'Cliente da VAN',
            subtitle: 'Não existe · transporte manual',
            frente: 'sispag',
            camada: 'cliente',
            maturidade: 'inexistente',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'O cliente que levaria a remessa ao banco e traria o retorno. Não existe: a remessa é gerada pelo ERP e baixada pela tela, o transporte à VAN é feito por uma pessoa, e o retorno entra de volta pelo ERP. A Frente IV também não precisou dele — o extrato vem do ERP. No código há só um stub de contrato.',
            arquivos: ['src/backend/domain/service/recebimentos/stubs/NexxeraGatewayStub.ts'],
            docRefs: [
                'ontology/_inbox/sispag-native-vs-nexxera.md',
                'ADR-0023 — extrato via Conexos',
            ],
        },
    },

    // ───────────────────────────── Externos / dados ────────────────────────────
    {
        id: 'tec-conexos-erp',
        position: { x: X_EXTERNO, y: -20 },
        data: {
            label: 'Conexos ERP',
            subtitle: 'Produção e homologação',
            frente: 'plataforma',
            camada: 'externo',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'O sistema de registro. A automação lê continuamente e escreve em pontos específicos, nas três frentes, em produção. Há um ambiente de homologação separado, e a doutrina do projeto é que nenhuma escrita nova vai a produção antes de ser validada nele. As escritas são ligadas por flag no painel do Render, sem redeploy.',
            programasErp: [
                'escrita: fin010 · fin014 · fin015 · com297 · com299',
                'leitura: fin050 · fin052 · fin064 · fin095 · fin124 · fin133',
                'leitura: com298 · com308 · imp019 · imp021 · imp223',
            ],
            docRefs: ['ADR-0013 — homologação-first'],
        },
    },
    {
        id: 'tec-supabase',
        position: { x: X_EXTERNO, y: 300 },
        data: {
            label: 'Postgres (Supabase)',
            subtitle: 'Só banco · 66 migrações',
            frente: 'plataforma',
            camada: 'dados',
            maturidade: 'implementado',
            estado: 'hoje',
            vista: 'tecnica',
            descricao:
                'Usado só como banco de dados, via pooler. Autenticação e armazenamento da plataforma não são usados — o login é próprio. As migrações rodam na subida do servidor (sob trava, antes de aceitar tráfego) e antes de cada job; o build copia os arquivos .sql para a pasta de produção, porque o compilador só emite JavaScript.',
            arquivos: [
                'src/backend/migrations/',
                'src/backend/migrations/MigrationFiles.ts',
            ],
            riscos: [
                {
                    nivel: 'medio',
                    texto:
                        'Até 2026-09-23 os .sql não chegavam à produção e as migrações da subida não rodavam; o sintoma foi abas de lotes vazias no SISPAG. Corrigido, mas vale para qualquer arquivo não-TypeScript lido em runtime.',
                    origem: 'DEPLOY.md',
                },
            ],
        },
    },
    {
        id: 'tec-rds',
        position: { x: X_EXTERNO, y: 300 },
        data: {
            label: 'Postgres gerenciado + segredos',
            subtitle: 'Um por cliente',
            frente: 'plataforma',
            camada: 'dados',
            maturidade: 'planejado',
            estado: 'alvo',
            vista: 'tecnica',
            descricao:
                'No estado-alvo cada cliente tem sua própria conta e seu próprio banco, com as credenciais vindo de um cofre de parâmetros em vez de variáveis de ambiente. O código que lê desse cofre já existe — está inativo porque a configuração atual fixa o modo local.',
            arquivos: ['src/backend/domain/libs/environment/EnvironmentProvider.ts'],
            docRefs: ['ontology/_inbox/migration-debt.md — I1 e I2'],
        },
    },
    {
        id: 'tec-obs',
        position: { x: X_EXTERNO, y: 480 },
        data: {
            label: 'Alerta fora do sistema',
            subtitle: 'Não existe · e-mail planejado',
            frente: 'plataforma',
            camada: 'infra',
            maturidade: 'inexistente',
            estado: 'hoje',
            vista: 'tecnica',
            descricao:
                'A detecção existe — registro de cada execução, detector de atraso, alerta de falha de workflow, painel de operação —, mas todo alerta termina dentro da própria plataforma: só é visto por quem abre o painel. O envio por e-mail está desenhado e aguarda credencial; a rota de saúde dos pipelines está pronta para um verificador externo, mas nenhum foi configurado. Não há rastreamento distribuído.',
            riscos: [
                {
                    nivel: 'alto',
                    texto:
                        'Numa plataforma que executa escritas que movem dinheiro, uma falha de cron ou de escrita só é notada quando alguém abre o painel de operação.',
                    origem: 'ADR-0042',
                },
            ],
        },
    },
    {
        id: 'tec-obs-alvo',
        position: { x: X_EXTERNO, y: 480 },
        data: {
            label: 'Rastreamento + alarmes',
            subtitle: 'Estado-alvo',
            frente: 'plataforma',
            camada: 'infra',
            maturidade: 'planejado',
            estado: 'alvo',
            vista: 'tecnica',
            descricao:
                'Log estruturado, rastreamento distribuído, métricas e alarmes por fluxo, com atenção especial aos caminhos de escrita. O log estruturado e o registro de execuções já existem no código; falta o destino e o alarme.',
            arquivos: ['src/backend/domain/service/LogService.ts'],
        },
    },
]

export const TECNICA_EDGES: ArqEdge[] = [
    // Hoje
    { id: 'te-1', source: 'tec-frontend', target: 'tec-express', label: 'HTTPS + Bearer', tipo: 'fluxo', estado: 'hoje', vista: 'tecnica' },
    { id: 'te-2', source: 'tec-auth-front', target: 'tec-express', tipo: 'fluxo', estado: 'hoje', vista: 'tecnica' },
    { id: 'te-3', source: 'tec-express', target: 'tec-acesso', tipo: 'fluxo', estado: 'hoje', vista: 'tecnica' },
    { id: 'te-6', source: 'tec-actions', target: 'tec-svc-permutas', label: '06/12/18h', tipo: 'agendamento', estado: 'hoje', vista: 'tecnica' },
    { id: 'te-7', source: 'tec-actions', target: 'tec-svc-sispag', label: '07h · 15 min', tipo: 'agendamento', estado: 'hoje', vista: 'tecnica' },
    { id: 'te-8', source: 'tec-actions', target: 'tec-svc-recebimentos', label: 'toda hora', tipo: 'agendamento', estado: 'hoje', vista: 'tecnica' },
    { id: 'te-9', source: 'tec-actions', target: 'tec-svc-plataforma', label: 'staleness', tipo: 'agendamento', estado: 'hoje', vista: 'tecnica' },

    // Alvo
    { id: 'te-a1', source: 'tec-frontend', target: 'tec-apigw', tipo: 'fluxo', estado: 'alvo', vista: 'tecnica' },
    { id: 'te-a2', source: 'tec-supabase-auth', target: 'tec-apigw', tipo: 'fluxo', estado: 'alvo', vista: 'tecnica' },
    { id: 'te-a3', source: 'tec-apigw', target: 'tec-acesso', tipo: 'fluxo', estado: 'alvo', vista: 'tecnica' },
    { id: 'te-a6', source: 'tec-eventbridge', target: 'tec-svc-permutas', tipo: 'agendamento', estado: 'alvo', vista: 'tecnica' },
    { id: 'te-a7', source: 'tec-eventbridge', target: 'tec-svc-sispag', tipo: 'agendamento', estado: 'alvo', vista: 'tecnica' },
    { id: 'te-a8', source: 'tec-eventbridge', target: 'tec-svc-recebimentos', tipo: 'agendamento', estado: 'alvo', vista: 'tecnica' },

    // Comuns
    { id: 'te-4', source: 'tec-acesso', target: 'tec-rota-permutas', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-5', source: 'tec-acesso', target: 'tec-rota-sispag', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-5b', source: 'tec-acesso', target: 'tec-rota-recebimentos', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-5c', source: 'tec-acesso', target: 'tec-rota-plataforma', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-10', source: 'tec-rota-permutas', target: 'tec-svc-permutas', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-11', source: 'tec-rota-sispag', target: 'tec-svc-sispag', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-11b', source: 'tec-rota-recebimentos', target: 'tec-svc-recebimentos', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-12', source: 'tec-rota-plataforma', target: 'tec-svc-plataforma', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-13', source: 'tec-svc-permutas', target: 'tec-repos', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-14', source: 'tec-svc-sispag', target: 'tec-repos', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-14b', source: 'tec-svc-recebimentos', target: 'tec-repos', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-14c', source: 'tec-svc-plataforma', target: 'tec-repos', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-15', source: 'tec-svc-permutas', target: 'tec-ledger', label: 'write-ahead', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-15b', source: 'tec-svc-sispag', target: 'tec-ledger', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-15c', source: 'tec-svc-recebimentos', target: 'tec-ledger', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-15d', source: 'tec-svc-plataforma', target: 'tec-di', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-16', source: 'tec-svc-permutas', target: 'tec-conexos-client', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-17', source: 'tec-svc-sispag', target: 'tec-conexos-client', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-17b', source: 'tec-svc-recebimentos', target: 'tec-conexos-client', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-18', source: 'tec-conexos-client', target: 'tec-sessao', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-19', source: 'tec-repos', target: 'tec-db-client', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-20', source: 'tec-ledger', target: 'tec-db-client', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-21', source: 'tec-conexos-client', target: 'tec-conexos-erp', label: 'leitura', tipo: 'leitura', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-22', source: 'tec-conexos-client', target: 'tec-conexos-erp', label: 'baixa · remessa · SN · NDe', tipo: 'escrita', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-23', source: 'tec-sessao', target: 'tec-conexos-erp', label: 'sid', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-24', source: 'tec-db-client', target: 'tec-supabase', tipo: 'fluxo', estado: 'hoje', vista: 'tecnica' },
    { id: 'te-25', source: 'tec-db-client', target: 'tec-rds', tipo: 'fluxo', estado: 'alvo', vista: 'tecnica' },
    { id: 'te-26', source: 'tec-sessao', target: 'tec-supabase', label: 'sid compartilhado', tipo: 'fluxo', estado: 'hoje', vista: 'tecnica' },
    { id: 'te-27', source: 'tec-svc-sispag', target: 'tec-nexxera-client', label: 'transporte manual', tipo: 'gap', estado: 'ambos', vista: 'tecnica', destaque: true },
    { id: 'te-28', source: 'tec-svc-plataforma', target: 'tec-obs', label: 'só no painel', tipo: 'gap', estado: 'hoje', vista: 'tecnica' },
    { id: 'te-29', source: 'tec-svc-plataforma', target: 'tec-obs-alvo', tipo: 'fluxo', estado: 'alvo', vista: 'tecnica' },
]
