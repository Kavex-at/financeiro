/**
 * Botões cheios na cor do card de ação (`CardsSituacao`, `CardsBoletosDda`): o `outline` cinza
 * parecia desabilitado ao lado do botão azul. O botão `success` usa o `default` do `Button`.
 *
 * `text-white` em perigo/info é de propósito: os tokens `danger-foreground`/`info-foreground` são
 * texto ESCURO para fundo `*-subtle` (#7f1d1d, #1e3a8a) e não têm contraste sobre o fundo cheio.
 */
export const BOTAO_PERIGO = 'bg-danger text-white hover:bg-danger/90'
export const BOTAO_ALERTA = 'bg-warning text-warning-foreground hover:bg-warning/90'
export const BOTAO_INFO = 'bg-info text-white hover:bg-info/90'
export const BOTAO_PRIMARIO = 'bg-primary text-primary-foreground hover:bg-primary/90'
