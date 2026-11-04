/**
 * O canal de contato do sistema, num lugar só.
 *
 * O aviso de privacidade, os termos de uso e a página de suporte apontam para
 * o mesmo endereço, e três cópias dele divergem na primeira vez que o contato
 * mudar. Enquanto a instituição não existe, o contato é o do próprio projeto
 * (docs/lgpd.md, seção 4); quando ela existir, é aqui que se troca.
 */
export const CONTATO = 'code.tcc.comp@gmail.com';

/**
 * Link `mailto:` para a pessoa relatar um problema, já com o roteiro do que
 * dizer. O texto é só um rascunho no programa de e-mail dela: nada sai do
 * aparelho até ela enviar, e nenhum dado da sessão entra no rascunho (senha,
 * código de verificação e endereço da página com identificador ficam de fora
 * de propósito).
 */
export function linkDeSuporte() {
  const assunto = 'Conserva Predial: problema técnico ou pedido de ajuda';
  const corpo = [
    'O que você estava tentando fazer:',
    '',
    'O que aconteceu (e a mensagem que apareceu, se houve):',
    '',
    'Em que tela isso aconteceu:',
    '',
    'Dia e hora aproximados:',
    '',
    'Aparelho e navegador (por exemplo: celular Android, Chrome):',
    '',
    '',
    'Não escreva sua senha nem o código de verificação.',
  ].join('\n');
  return `mailto:${CONTATO}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
}
