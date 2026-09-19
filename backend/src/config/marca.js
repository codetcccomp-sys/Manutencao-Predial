/**
 * O nome do sistema, num lugar só.
 *
 * Estava escrito à mão em cinco arquivos — dois deles em e-mail que sai para
 * fora. Renomear era caçar ocorrência por ocorrência, e quem esquecesse uma
 * mandaria mensagem assinada com o nome antigo sem ninguém perceber.
 *
 * O prefixo do protocolo NÃO acompanha o nome, de propósito. `SMP-` já está
 * gravado nos chamados existentes e é o que as pessoas leem em papel, e-mail e
 * conversa. Mudá-lo criaria duas gerações de protocolo no mesmo banco, sem
 * ganho nenhum para quem usa.
 */

const NOME_SISTEMA = 'Conserva Predial';

/** Assinatura de rodapé das mensagens que saem para fora. */
const ASSINATURA = `${NOME_SISTEMA} — Sistema de Manutenção`;

module.exports = { NOME_SISTEMA, ASSINATURA };
