import type { ExcecaoAcesso, LinhaHistorico } from '@/lib/api/perfil'
import { isPermissao, rotuloPermissao } from '@/lib/permissoes'

/**
 * Rótulo legível do alvo de uma linha do histórico. O id cru (`alvoId`) continua sendo a chave do
 * link e vai no `title` (tooltip), para suporte; a tela mostra o que um analista reconhece:
 * "Lote nº 231001", "Título 5503/2", "Retorno do banco 341", "Papel: A → B".
 */
export interface RotuloAlvo {
  /** Rótulo completo ("Lote nº 231001"). */
  texto: string
  /** Quando há um código que o analista copia para o ERP: o texto se divide em prefixo + código. */
  prefixo?: string
  codigo?: string
  /** Linha secundária opcional (contagens, filial). */
  detalhe?: string
  /** Id cru, para o tooltip. */
  titulo: string
}

const nomePermissao = (p: string): string => (isPermissao(p) ? rotuloPermissao(p) : p)

/** "Lote #" cola no código; os outros prefixos levam espaço. */
export const separador = (prefixo: string): string => (prefixo.endsWith('#') ? '' : ' ')

const comCodigo = (prefixo: string, codigo: string, resto: Omit<RotuloAlvo, 'texto'>): RotuloAlvo => ({
  texto: `${prefixo}${separador(prefixo)}${codigo}`,
  prefixo,
  codigo,
  ...resto,
})

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** O que mudou entre duas listas de exceções da trilha (`AccessRepository`). */
export const descreverExcecoes = (antes: ExcecaoAcesso[] = [], depois: ExcecaoAcesso[] = []): string => {
  const eraAntes = new Map(antes.map((e) => [e.permissao, e.efeito]))
  const ficouDepois = new Map(depois.map((e) => [e.permissao, e.efeito]))
  const mudancas: string[] = []
  for (const [permissao, efeito] of ficouDepois) {
    if (eraAntes.get(permissao) !== efeito) {
      mudancas.push(`${nomePermissao(permissao)} ${efeito === 'conceder' ? 'concedida' : 'revogada'}`)
    }
  }
  for (const permissao of eraAntes.keys()) {
    if (!ficouDepois.has(permissao)) mudancas.push(`${nomePermissao(permissao)}: exceção removida`)
  }
  return mudancas.length ? mudancas.join('; ') : 'Exceções de permissão'
}

const descreverAcesso = (l: LinhaHistorico): string => {
  const d = l.detalhe
  switch (d.tipoAcesso) {
    case 'papel':
      if (d.papelDepois) return d.papelAntes ? `Papel: ${d.papelAntes} → ${d.papelDepois}` : `Papel: ${d.papelDepois}`
      return 'Papel alterado'
    case 'ativo':
      if (d.ativoDepois === true) return 'Usuário reativado'
      if (d.ativoDepois === false) return 'Usuário desativado'
      return 'Status do usuário alterado'
    case 'excecao':
      return descreverExcecoes(d.excecoesAntes, d.excecoesDepois)
    case 'senha':
      return 'Senha alterada'
    default:
      return 'Acesso alterado'
  }
}

export const rotuloAlvo = (l: LinhaHistorico): RotuloAlvo => {
  const d = l.detalhe
  const titulo = `${l.alvoTipo} ${l.alvoId}`
  const filial = d.filCod !== undefined ? `filial ${d.filCod}` : undefined
  switch (l.alvoTipo) {
    case 'adiantamento':
      return comCodigo('Adiantamento', l.alvoId, { detalhe: filial, titulo })
    case 'processo':
      return comCodigo('Processo', l.alvoId, { detalhe: filial, titulo })
    case 'lote':
      return comCodigo(
        d.remessaNum !== undefined ? 'Lote nº' : 'Lote #',
        d.remessaNum !== undefined ? String(d.remessaNum) : l.alvoId.slice(0, 8),
        {
          detalhe: [filial, d.banco ? `banco ${d.banco}` : undefined].filter(Boolean).join(' · ') || undefined,
          titulo,
        },
      )
    case 'titulo':
      return comCodigo('Título', d.docCod && d.titCod ? `${d.docCod}/${d.titCod}` : l.alvoId, {
        detalhe: filial,
        titulo,
      })
    case 'retorno': {
      const contagens =
        d.agendados !== undefined || d.rejeitados !== undefined
          ? `${plural(d.agendados ?? 0, 'agendado', 'agendados')}, ${plural(d.rejeitados ?? 0, 'rejeitado', 'rejeitados')}`
          : undefined
      return {
        texto: d.bncCod !== undefined ? `Retorno do banco ${d.bncCod}` : 'Retorno bancário',
        detalhe: [filial, contagens].filter(Boolean).join(' · ') || undefined,
        titulo,
      }
    }
    case 'alerta':
      return { texto: d.alvoAlerta ? `Alerta: ${d.alvoAlerta}` : `Alerta #${l.alvoId}`, titulo }
    case 'usuario': {
      const mudanca = descreverAcesso(l)
      // Quem alterou o acesso de outra pessoa vê de quem foi; quem sofreu a alteração é o próprio.
      const texto = l.acao === 'acesso_alterado' && d.outroUsername ? `${d.outroUsername}: ${mudanca}` : mudanca
      return { texto, titulo }
    }
    default:
      return { texto: l.alvoId, titulo }
  }
}

/** Ação → frase em português. O código vem do servidor; o texto mora aqui. */
export const descreverAcao = (l: LinhaHistorico): string => {
  const outro = l.detalhe.outroUsername ?? 'outro usuário'
  switch (l.acao) {
    case 'baixa_permuta':
      return 'Baixa de permuta'
    case 'excecao_criada':
      return 'Marcou permutado fora do painel'
    case 'excecao_removida':
      return 'Desfez exceção de permuta'
    case 'lote_criado':
      return 'Criou lote'
    case 'lote_finalizado':
      return 'Finalizou lote'
    case 'remessa_gerada':
      return 'Gerou remessa'
    case 'retorno_conciliado':
      return 'Conciliou retorno'
    case 'numerario_executado':
      return 'Executou solicitação de numerário'
    case 'alerta_reconhecido':
      return `Reconheceu alerta${l.detalhe.tipoAlerta ? ` (${l.detalhe.tipoAlerta})` : ''}`
    case 'acesso_alterado':
      return l.detalhe.tipoAcesso === 'senha' ? `Redefiniu a senha de ${outro}` : `Alterou acesso de ${outro}`
    case 'acesso_recebido':
      // Sem "outro" = ator e alvo são o próprio usuário (ex.: troca da própria senha, ADR-0059).
      if (l.detalhe.tipoAcesso === 'senha') {
        return l.detalhe.outroUsername ? `Sua senha foi redefinida por ${outro}` : 'Alterou a própria senha'
      }
      return l.detalhe.outroUsername ? `Seu acesso foi alterado por ${outro}` : 'Alterou o próprio acesso'
    default:
      return l.acao
  }
}
