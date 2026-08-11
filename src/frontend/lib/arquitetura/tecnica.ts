/**
 * Vista TÉCNICA — colunas por camada, da borda HTTP aos sistemas externos.
 *
 * Nós marcados com `estado: 'alvo'` só aparecem no recorte "Alvo" do toggle;
 * eles descrevem a arquitetura de destino (Lambda, Terraform, multi-tenant)
 * declarada no CLAUDE.md e que hoje não existe.
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
        position: { x: X_JOB, y: -220 },
        data: {
            label: 'GitHub Actions (cron)',
            subtitle: 'O scheduler de produção',
            frente: 'plataforma',
            camada: 'job',
            maturidade: 'implementado',
            estado: 'hoje',
            vista: 'tecnica',
            descricao:
                'A cadência diária das frentes roda aqui, e não no servidor de aplicação. Dois workflows agendados executam os mesmos scripts npm que um operador rodaria à mão: ingestão de permutas três vezes ao dia e ingestão de pagamentos seguida da formação de lotes uma vez ao dia. A escolha foi de custo — o agendador da plataforma de hospedagem é pago. Cada execução roda as migrações antes do job.',
            arquivos: [
                '.github/workflows/ingest-permutas.yml',
                '.github/workflows/ingest-sispag.yml',
                'src/backend/jobs/ingest-permutas.ts',
                'src/backend/jobs/ingest-pagamentos.ts',
                'src/backend/jobs/formar-lotes.ts',
            ],
            riscos: [
                {
                    nivel: 'medio',
                    texto:
                        'Não há runtime de job propriamente dito: sem retentativa própria, sem alerta de falha e sem observabilidade. Se um cron falhar silenciosamente, ninguém é avisado. Os workflows também rodam numa versão de Node diferente da usada na integração contínua.',
                    origem: 'ontology/_inbox/migration-debt.md — O4',
                },
            ],
            docRefs: ['ontology/_inbox/migration-debt.md — O4'],
        },
    },
    {
        id: 'tec-eventbridge',
        position: { x: X_JOB, y: -220 },
        data: {
            label: 'EventBridge + Lambda job',
            subtitle: 'Scheduler gerenciado',
            frente: 'plataforma',
            camada: 'job',
            maturidade: 'planejado',
            estado: 'alvo',
            vista: 'tecnica',
            descricao:
                'No estado-alvo a cadência passa a um agendador gerenciado, com retentativa, fila de mensagens mortas e alarme nativo — resolvendo a lacuna de runtime de job que hoje bloqueia tanto o polling de retorno do SISPAG quanto o monitoramento de diretório da frente de GED.',
            docRefs: ['CLAUDE.md — estado-alvo'],
        },
    },

    // ─────────────────────────────────── UI ────────────────────────────────────
    {
        id: 'tec-frontend',
        position: { x: X_UI, y: 60 },
        data: {
            label: 'Next.js 16 (App Router)',
            subtitle: 'Vercel',
            frente: 'plataforma',
            camada: 'ui',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Aplicação React 19 com App Router, Tailwind 4 e componentes shadcn/ui copiados para dentro do repositório. Sem biblioteca de cache de dados: as telas usam fetch direto com hooks próprios. O deploy é automático a cada push na branch principal.',
            arquivos: [
                'src/frontend/app/permutas/page.tsx',
                'src/frontend/app/sispag/page.tsx',
                'src/frontend/lib/api.ts',
                'src/frontend/lib/sispag.ts',
            ],
            riscos: [
                {
                    nivel: 'medio',
                    texto:
                        'A build do frontend não roda na integração contínua — só na plataforma de deploy. Uma quebra de build só aparece no momento do deploy, depois do merge.',
                    origem: '.github/workflows/ci.yml',
                },
                {
                    nivel: 'medio',
                    texto:
                        'A tela de permutas passa de duas mil linhas num único arquivo, praticamente sem teste. Os limites de cobertura do frontend estão deliberadamente baixos por reconhecerem isso.',
                    origem: 'Regis-Review — modifiability / testability',
                },
            ],
        },
    },
    {
        id: 'tec-auth-front',
        position: { x: X_UI, y: 300 },
        data: {
            label: 'Sessão no navegador',
            subtitle: 'JWT em localStorage',
            frente: 'plataforma',
            camada: 'ui',
            maturidade: 'implementado',
            estado: 'hoje',
            vista: 'tecnica',
            descricao:
                'A sessão é custodiada pelo provedor de identidade em cookies, com renovação automática e revogação real no logout. A proteção de rotas acontece na borda, antes de a página chegar ao navegador, e é reforçada no cliente como segunda barreira. O papel do usuário é lido do banco a cada requisição, não do próprio token.',
            arquivos: [
                'src/frontend/middleware.ts',
                'src/frontend/lib/supabase/middleware.ts',
                'src/frontend/lib/supabase/client.ts',
                'src/frontend/lib/auth/token.ts',
                'src/frontend/components/auth/RouteGate.tsx',
            ],
            riscos: [
                {
                    nivel: 'medio',
                    texto:
                        'Resolvido pela troca de provedor de identidade: a sessão passou a ter renovação, rotação e revogação. O risco residual é a latência declarada da revogação administrativa — até trinta segundos —, e ela só permanece um teto real enquanto o backend rodar em instância única.',
                    origem: 'Regis-Review — security',
                },
            ],
        },
    },
    {
        id: 'tec-sso',
        position: { x: X_UI, y: 300 },
        data: {
            label: 'SSO corporativo + RBAC',
            subtitle: 'Autenticação da empresa',
            frente: 'plataforma',
            camada: 'ui',
            maturidade: 'planejado',
            estado: 'alvo',
            vista: 'tecnica',
            descricao:
                'O estado-alvo prevê autenticação corporativa com controle por perfil, substituindo o login próprio com usuário e senha. É também um requisito não-funcional explícito da proposta comercial.',
            docRefs: ['docs/proposta §6 — requisitos transversais'],
        },
    },

    // ────────────────────────────── Borda HTTP ─────────────────────────────────
    {
        id: 'tec-express',
        position: { x: X_EDGE, y: 60 },
        data: {
            label: 'Express 5',
            subtitle: 'Render · deploy automático',
            frente: 'plataforma',
            camada: 'edge',
            maturidade: 'implementado',
            estado: 'hoje',
            vista: 'tecnica',
            descricao:
                'O servidor de aplicação. A cadeia de middlewares é, em ordem: CORS, limite global de requisições, identificador de requisição, log, autenticação, identidade no ERP e limite reforçado nas rotas pesadas. O deploy é automático a cada push na branch principal, com as migrações rodando antes de subir e verificação de saúde numa rota dedicada.',
            arquivos: [
                'src/backend/index.ts',
                'src/backend/http/auth.ts',
                'src/backend/http/rateLimit.ts',
                'src/backend/http/cors.ts',
                'render.yaml',
            ],
            riscos: [
                {
                    nivel: 'alto',
                    texto:
                        'A trava que impede o modo de bypass de autenticação em produção não dispara para o valor de ambiente efetivamente configurado — a lista de ambientes bloqueados não contém o valor usado. Hoje não é explorável porque a flag está explicitamente desligada, mas a proteção em profundidade não existe.',
                    origem: 'src/backend/http/authEnv.ts × render.yaml',
                },
                {
                    nivel: 'medio',
                    texto:
                        'O log global imprime o corpo das requisições. Precisa ser endurecido antes de dados bancários e valores de pagamento passarem por aqui.',
                    origem: 'Regis-Review — risco LGPD sec-4',
                },
            ],
        },
    },
    {
        id: 'tec-apigw',
        position: { x: X_EDGE, y: 60 },
        data: {
            label: 'API Gateway + Lambda',
            subtitle: 'Uma conta por cliente',
            frente: 'plataforma',
            camada: 'edge',
            maturidade: 'planejado',
            estado: 'alvo',
            vista: 'tecnica',
            descricao:
                'A borda do estado-alvo. Cada rota vira uma função isolada, embrulhada por um handler que já cuida de log, metadados e tratamento de erro. Esse handler já existe no repositório, escrito e pronto — apenas sem nenhum importador, porque o runtime ainda é o servidor Express.',
            arquivos: ['src/backend/domain/libs/handler/ApiGatewayHandler.ts'],
            docRefs: ['ontology/_inbox/migration-debt.md — B1'],
        },
    },
    {
        id: 'tec-handler-orfao',
        position: { x: X_EDGE, y: 300 },
        data: {
            label: 'Código pronto para o alvo',
            subtitle: 'Escrito, sem uso',
            frente: 'plataforma',
            camada: 'edge',
            maturidade: 'orfao',
            estado: 'hoje',
            vista: 'tecnica',
            descricao:
                'Três peças existem no repositório sem nenhum importador: o handler de API Gateway, um relator de progresso por streaming que nenhuma rota conecta, e o cliente do Banco Central, cuja função migrou para um programa do próprio ERP. São a ponte já construída para o estado-alvo — e também candidatos a remoção, se o alvo demorar.',
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
        position: { x: X_ROTA, y: -40 },
        data: {
            label: 'Rotas de permutas',
            subtitle: '26 endpoints',
            frente: 'permutas',
            camada: 'rota',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Eleição, ingestão, painel, gestão, alocação, reconciliação, borderôs e relatórios. As mutações exigem perfil de administrador e passam pelo limite reforçado de requisições; as leituras bastam estar autenticadas. Erros do ERP são traduzidos por um interpretador dedicado antes de chegarem à tela.',
            arquivos: ['src/backend/routes/permutas.ts'],
            docRefs: ['ADR-0011 — endurecimento da API', 'ADR-0012 — escopo do limite de requisições'],
        },
    },
    {
        id: 'tec-rota-sispag',
        position: { x: X_ROTA, y: 200 },
        data: {
            label: 'Rotas de SISPAG',
            subtitle: '13 endpoints · atrás de flag',
            frente: 'sispag',
            camada: 'rota',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Painel, lotes e ingestão. Todo o conjunto está atrás de uma porteira que devolve acesso negado quando a frente não está habilitada — e o padrão seguro é bloquear em produção salvo habilitação explícita. Os erros de domínio do lote viram códigos HTTP específicos, incluindo conflito de versão quando dois analistas mexem no mesmo lote.',
            arquivos: ['src/backend/routes/sispag.ts', 'src/backend/http/sispagGate.ts'],
            riscos: [
                {
                    nivel: 'medio',
                    texto:
                        'Não há verificação de filial por usuário: a filial vem no corpo da requisição sem conferir se aquele usuário pode operá-la.',
                    origem: 'Regis-Review — RBAC de filial ausente',
                },
            ],
        },
    },
    {
        id: 'tec-rota-auth',
        position: { x: X_ROTA, y: 430 },
        data: {
            label: 'Rotas de acesso',
            subtitle: 'login · usuários · identidade',
            frente: 'plataforma',
            camada: 'rota',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Login com usuário e senha, administração de usuários restrita a administradores, e consulta do estado do vínculo com o ERP. A senha é verificada contra um hash forte e o token é assinado pelo próprio sistema.',
            arquivos: [
                'src/backend/routes/auth.ts',
                'src/backend/routes/usuarios.ts',
                'src/backend/routes/me.ts',
            ],
        },
    },

    // ────────────────────────────── Serviços ───────────────────────────────────
    {
        id: 'tec-svc-permutas',
        position: { x: X_SERVICO, y: -40 },
        data: {
            label: 'Serviços de permutas',
            subtitle: '12 classes',
            frente: 'permutas',
            camada: 'servico',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Onde vive a regra de negócio da frente: eleição, elegibilidade, alocação, variação cambial, gestão de borderô, reconciliação e exportação de relatórios. A ingestão tem um serviço que funde chamadas simultâneas numa só, evitando que dois disparos concorrentes façam o mesmo trabalho duas vezes.',
            arquivos: [
                'src/backend/domain/service/permutas/EleicaoPermutasService.ts',
                'src/backend/domain/service/permutas/AlocacaoPermutasService.ts',
                'src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts',
                'src/backend/domain/service/permutas/BorderoGestaoService.ts',
            ],
        },
    },
    {
        id: 'tec-svc-sispag',
        position: { x: X_SERVICO, y: 200 },
        data: {
            label: 'Serviços de SISPAG',
            subtitle: '4 classes',
            frente: 'sispag',
            camada: 'servico',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Ingestão da carteira, montagem do painel, formação automática de lotes e o ciclo de vida do lote. A concorrência entre analistas é resolvida por número de versão no registro; a concorrência entre execuções da ingestão, por trava no banco.',
            arquivos: [
                'src/backend/domain/service/sispag/IngestaoPagamentosService.ts',
                'src/backend/domain/service/sispag/LotePagamentoService.ts',
                'src/backend/domain/service/sispag/FormacaoLotesService.ts',
                'src/backend/domain/service/sispag/SispagPainelService.ts',
            ],
            riscos: [
                {
                    nivel: 'medio',
                    texto:
                        'A inclusão de títulos no lote é sequencial: cerca de vinte e seis segundos para vinte títulos. E uma falha silenciosa na leitura da carteira faz cair num caminho sem filtro que devolve dezoito mil linhas.',
                    origem: 'Regis-Review — performance / availability',
                },
            ],
        },
    },
    {
        id: 'tec-di',
        position: { x: X_SERVICO, y: 430 },
        data: {
            label: 'Injeção de dependências',
            subtitle: 'tsyringe',
            frente: 'plataforma',
            camada: 'servico',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Nada é instanciado diretamente: tudo é resolvido por um contêiner com inicialização única, que registra os clientes, aquece a conexão com o ERP e aplica as migrações pendentes na subida. É a peça que já está no padrão do estado-alvo mesmo rodando no servidor atual.',
            arquivos: ['src/backend/domain/appContainer.ts'],
        },
    },

    // ───────────────────────────── Repositórios ────────────────────────────────
    {
        id: 'tec-repos',
        position: { x: X_REPO, y: 80 },
        data: {
            label: 'Repositórios',
            subtitle: '10 classes · SQL parametrizado',
            frente: 'plataforma',
            camada: 'repositorio',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'A única porta para o banco. SQL sempre parametrizado, nunca interpolado. Cobrem os dados de permutas — candidatas, alocações, execuções, borderôs —, os de SISPAG — títulos, lotes, execuções de ingestão — e os usuários.',
            arquivos: [
                'src/backend/domain/repository/permutas/',
                'src/backend/domain/repository/sispag/',
                'src/backend/domain/repository/auth/UserRepository.ts',
            ],
        },
    },
    {
        id: 'tec-ledger',
        position: { x: X_REPO, y: 320 },
        data: {
            label: 'Ledger de execução',
            subtitle: 'Idempotência da escrita',
            frente: 'permutas',
            camada: 'repositorio',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Registro escrito antes da chamada ao ERP, não depois. Guarda a chave de idempotência, o que foi enviado e o que voltou, percorrendo os estados de pendente a liquidado ou erro. É o que permite saber, após uma queda no meio da operação, se a baixa chegou a acontecer.',
            arquivos: [
                'src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts',
                'ontology/business-rules/idempotencia-reconciliacao.md',
            ],
        },
    },

    // ─────────────────────────────── Clientes ──────────────────────────────────
    {
        id: 'tec-conexos-client',
        position: { x: X_CLIENTE, y: -40 },
        data: {
            label: 'Cliente Conexos',
            subtitle: 'Base + 5 especializados',
            frente: 'plataforma',
            camada: 'cliente',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Um cliente base concentra paginação, retentativa e conversão de tipos; cinco clientes especializados o consomem, um por área do ERP — cadastro, financeiro, títulos, baixa e SISPAG. A escrita da baixa é a exceção deliberada: usa um caminho que não repete em caso de falha de autenticação, porque repetir significaria baixa duplicada.',
            arquivos: [
                'src/backend/domain/client/ConexosBaseClient.ts',
                'src/backend/domain/client/permutas/ConexosBaixaClient.ts',
                'src/backend/domain/client/sispag/ConexosSispagClient.ts',
            ],
        },
    },
    {
        id: 'tec-sessao',
        position: { x: X_CLIENTE, y: 210 },
        data: {
            label: 'Sessão do ERP',
            subtitle: 'Compartilhada · por usuário',
            frente: 'plataforma',
            camada: 'cliente',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Uma arquitetura própria, e uma das partes mais sutis do sistema. O identificador de sessão do ERP é compartilhado entre processos numa tabela do banco, com controle de concorrência otimista e validade de vinte e cinco minutos. Quando o ERP recusa por excesso de sessões, a mais antiga é encerrada. As chamadas rodam sob as credenciais do próprio analista — guardadas cifradas — com queda silenciosa para a conta de robô quando não há vínculo. É também o motivo de os dois crons diários estarem deslocados em uma hora: eles disputariam sessão.',
            arquivos: [
                'src/backend/services/conexosSessionStore.ts',
                'src/backend/domain/client/ConexosSessionRegistry.ts',
                'src/backend/domain/client/ConexosSessionResolver.ts',
                'src/backend/domain/libs/crypto/SecretCipher.ts',
            ],
        },
    },
    {
        id: 'tec-db-client',
        position: { x: X_CLIENTE, y: 460 },
        data: {
            label: 'Cliente Postgres',
            subtitle: 'Pool · transação · trava',
            frente: 'plataforma',
            camada: 'cliente',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'Pool de no máximo cinco conexões, com retentativa para falhas transitórias e travas cooperativas que serializam as ingestões. Evita deliberadamente instruções preparadas nomeadas, por incompatibilidade com o modo de pooling usado.',
            arquivos: ['src/backend/domain/client/database/PostgreeDatabaseClient.ts'],
        },
    },
    {
        id: 'tec-nexxera-client',
        position: { x: X_CLIENTE, y: 690 },
        data: {
            label: 'Cliente da VAN',
            subtitle: 'Não existe',
            frente: 'sispag',
            camada: 'cliente',
            maturidade: 'inexistente',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'O cliente que levaria o arquivo de remessa ao banco e traria o retorno. Não existe — nem cliente, nem configuração, nem modelagem. Junto com as integrações de SharePoint e GED, é o que bloqueia a conclusão do SISPAG e a frente de GED inteira.',
            riscos: [
                {
                    nivel: 'alto',
                    texto:
                        'Integrações com VAN, SharePoint e GED inexistentes. Bloqueiam a etapa final do SISPAG e toda a Frente III.',
                    origem: 'ontology/_inbox/migration-debt.md — O7',
                },
            ],
        },
    },

    // ───────────────────────────── Externos / dados ────────────────────────────
    {
        id: 'tec-conexos-erp',
        position: { x: X_EXTERNO, y: 60 },
        data: {
            label: 'Conexos ERP',
            subtitle: 'Produção e homologação',
            frente: 'plataforma',
            camada: 'externo',
            maturidade: 'implementado',
            estado: 'ambos',
            vista: 'tecnica',
            descricao:
                'O sistema de registro. A automação lê continuamente e escreve em pontos muito específicos. Há um ambiente de homologação separado, e a doutrina do projeto é que nenhuma escrita nova vai a produção antes de ser validada nele.',
            programasErp: [
                'fin010 · fin015 · fin052 · fin064',
                'com298 · com299 · com308 · com311',
                'imp019 · imp021 · imp223',
            ],
            docRefs: ['ADR-0013 — homologação-first'],
        },
    },
    {
        id: 'tec-supabase',
        position: { x: X_EXTERNO, y: 320 },
        data: {
            label: 'Postgres (Supabase)',
            subtitle: 'Só banco de dados',
            frente: 'plataforma',
            camada: 'dados',
            maturidade: 'implementado',
            estado: 'hoje',
            vista: 'tecnica',
            descricao:
                'Usado exclusivamente como banco de dados, via conexão direta pelo pooler. A biblioteca cliente da plataforma não está instalada, e os recursos de autenticação e armazenamento não são usados — o login é próprio. Vinte e nove migrações versionadas, aplicadas tanto no deploy quanto na subida da aplicação.',
            arquivos: ['src/backend/migrations/'],
            riscos: [
                {
                    nivel: 'medio',
                    texto:
                        'Restou no código um caminho legado de verificação de token pela plataforma, e comentários no frontend ainda descrevem a autenticação antiga. É confusão de leitura, não falha ativa.',
                },
            ],
        },
    },
    {
        id: 'tec-rds',
        position: { x: X_EXTERNO, y: 320 },
        data: {
            label: 'Postgres gerenciado + segredos',
            subtitle: 'Um por cliente',
            frente: 'plataforma',
            camada: 'dados',
            maturidade: 'planejado',
            estado: 'alvo',
            vista: 'tecnica',
            descricao:
                'No estado-alvo cada cliente tem sua própria conta e seu próprio banco, com as credenciais vindo de um cofre de parâmetros em vez de variáveis de ambiente. O código que lê desse cofre já existe e funciona — está inativo apenas porque a configuração atual fixa o modo local.',
            arquivos: ['src/backend/domain/libs/environment/EnvironmentProvider.ts'],
            docRefs: ['ontology/_inbox/migration-debt.md — I1 e I2'],
        },
    },
    {
        id: 'tec-obs',
        position: { x: X_EXTERNO, y: 570 },
        data: {
            label: 'Observabilidade',
            subtitle: 'Ausente',
            frente: 'plataforma',
            camada: 'infra',
            maturidade: 'inexistente',
            estado: 'hoje',
            vista: 'tecnica',
            descricao:
                'Não há monitoramento externo. Todo erro termina na saída padrão do servidor de hospedagem, sem alerta, sem rastreamento distribuído e sem retenção. Numa plataforma que executa escritas que movem dinheiro, é a lacuna estrutural mais séria — e a proposta comercial lista observabilidade com alertas como requisito transversal.',
            riscos: [
                {
                    nivel: 'alto',
                    texto:
                        'Zero monitoramento externo. Falha de cron, erro de escrita no ERP e indisponibilidade passam despercebidos até alguém reclamar.',
                    origem: 'Regis-Review — availability 5.0 · migration-debt B4',
                },
            ],
            docRefs: ['ontology/_inbox/migration-debt.md — B4'],
        },
    },
    {
        id: 'tec-obs-alvo',
        position: { x: X_EXTERNO, y: 570 },
        data: {
            label: 'Rastreamento + alarmes',
            subtitle: 'Estado-alvo',
            frente: 'plataforma',
            camada: 'infra',
            maturidade: 'planejado',
            estado: 'alvo',
            vista: 'tecnica',
            descricao:
                'Log estruturado, rastreamento distribuído, métricas e alarmes por fluxo — com atenção especial aos caminhos de escrita. O log estruturado já existe no código; falta o destino e o alarme.',
            arquivos: ['src/backend/domain/service/LogService.ts'],
        },
    },
]

export const TECNICA_EDGES: ArqEdge[] = [
    // Hoje
    { id: 'te-1', source: 'tec-frontend', target: 'tec-express', label: 'HTTPS + Bearer', tipo: 'fluxo', estado: 'hoje', vista: 'tecnica' },
    { id: 'te-2', source: 'tec-auth-front', target: 'tec-express', tipo: 'fluxo', estado: 'hoje', vista: 'tecnica' },
    { id: 'te-3', source: 'tec-express', target: 'tec-rota-permutas', tipo: 'fluxo', estado: 'hoje', vista: 'tecnica' },
    { id: 'te-4', source: 'tec-express', target: 'tec-rota-sispag', tipo: 'fluxo', estado: 'hoje', vista: 'tecnica' },
    { id: 'te-5', source: 'tec-express', target: 'tec-rota-auth', tipo: 'fluxo', estado: 'hoje', vista: 'tecnica' },
    { id: 'te-6', source: 'tec-actions', target: 'tec-svc-permutas', label: '3x/dia', tipo: 'agendamento', estado: 'hoje', vista: 'tecnica' },
    { id: 'te-7', source: 'tec-actions', target: 'tec-svc-sispag', label: '07h BRT', tipo: 'agendamento', estado: 'hoje', vista: 'tecnica' },

    // Alvo
    { id: 'te-a1', source: 'tec-frontend', target: 'tec-apigw', tipo: 'fluxo', estado: 'alvo', vista: 'tecnica' },
    { id: 'te-a2', source: 'tec-sso', target: 'tec-apigw', tipo: 'fluxo', estado: 'alvo', vista: 'tecnica' },
    { id: 'te-a3', source: 'tec-apigw', target: 'tec-rota-permutas', tipo: 'fluxo', estado: 'alvo', vista: 'tecnica' },
    { id: 'te-a4', source: 'tec-apigw', target: 'tec-rota-sispag', tipo: 'fluxo', estado: 'alvo', vista: 'tecnica' },
    { id: 'te-a5', source: 'tec-apigw', target: 'tec-rota-auth', tipo: 'fluxo', estado: 'alvo', vista: 'tecnica' },
    { id: 'te-a6', source: 'tec-eventbridge', target: 'tec-svc-permutas', tipo: 'agendamento', estado: 'alvo', vista: 'tecnica' },
    { id: 'te-a7', source: 'tec-eventbridge', target: 'tec-svc-sispag', tipo: 'agendamento', estado: 'alvo', vista: 'tecnica' },

    // Comuns
    { id: 'te-10', source: 'tec-rota-permutas', target: 'tec-svc-permutas', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-11', source: 'tec-rota-sispag', target: 'tec-svc-sispag', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-12', source: 'tec-rota-auth', target: 'tec-di', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-13', source: 'tec-svc-permutas', target: 'tec-repos', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-14', source: 'tec-svc-sispag', target: 'tec-repos', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-15', source: 'tec-svc-permutas', target: 'tec-ledger', label: 'write-ahead', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-16', source: 'tec-svc-permutas', target: 'tec-conexos-client', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-17', source: 'tec-svc-sispag', target: 'tec-conexos-client', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-18', source: 'tec-conexos-client', target: 'tec-sessao', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-19', source: 'tec-repos', target: 'tec-db-client', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-20', source: 'tec-ledger', target: 'tec-db-client', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-21', source: 'tec-conexos-client', target: 'tec-conexos-erp', label: 'leitura', tipo: 'leitura', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-22', source: 'tec-conexos-client', target: 'tec-conexos-erp', label: 'baixa fin010', tipo: 'escrita', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-23', source: 'tec-sessao', target: 'tec-conexos-erp', label: 'sid', tipo: 'fluxo', estado: 'ambos', vista: 'tecnica' },
    { id: 'te-24', source: 'tec-db-client', target: 'tec-supabase', tipo: 'fluxo', estado: 'hoje', vista: 'tecnica' },
    { id: 'te-25', source: 'tec-db-client', target: 'tec-rds', tipo: 'fluxo', estado: 'alvo', vista: 'tecnica' },
    { id: 'te-26', source: 'tec-sessao', target: 'tec-supabase', label: 'sid compartilhado', tipo: 'fluxo', estado: 'hoje', vista: 'tecnica' },
    { id: 'te-27', source: 'tec-svc-sispag', target: 'tec-nexxera-client', label: 'lacuna', tipo: 'gap', estado: 'ambos', vista: 'tecnica', destaque: true },
    { id: 'te-28', source: 'tec-express', target: 'tec-obs', label: 'só stdout', tipo: 'gap', estado: 'hoje', vista: 'tecnica' },
    { id: 'te-29', source: 'tec-apigw', target: 'tec-obs-alvo', tipo: 'fluxo', estado: 'alvo', vista: 'tecnica' },
]
