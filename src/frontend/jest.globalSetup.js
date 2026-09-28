/**
 * Fixa o fuso da suíte em Brasília, o fuso de quem usa o sistema. Roda no processo pai, antes dos
 * workers nascerem, e eles herdam o TZ. Mudar `process.env.TZ` dentro de um teste não vale: o
 * worker já inicializou o fuso. Sem isto, a suíte passa na máquina local (BRT) e roda em UTC no CI,
 * que esconde justamente o bug de data civil recuando um dia.
 */
module.exports = () => {
    process.env.TZ = 'America/Sao_Paulo'
}
