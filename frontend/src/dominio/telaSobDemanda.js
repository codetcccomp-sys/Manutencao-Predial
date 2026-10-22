import { lazy } from 'react';

/**
 * Carrega uma tela só quando a rota é aberta.
 *
 * O aplicativo era um arquivo só de 509 kB (165 kB comprimido): quem abre a fila
 * no celular baixava, de uma vez, os relatórios, os cadastros e a geração de QR
 * Code que talvez nunca use. As telas de gestão agora vêm sob demanda.
 *
 * O preço é um defeito novo que um arquivo só não tem: depois de uma publicação, os
 * arquivos com hash da versão antiga somem do servidor, e uma aba que já estava
 * aberta pede um pedaço que não existe mais. O navegador responde com "Failed to
 * fetch dynamically imported module" e a tela ficaria em branco. A saída é recarregar
 * a página uma vez, que busca o `index.html` novo e os pedaços certos. Só uma vez
 * (marca na sessão): se continuar falhando, o problema é a conexão, não a versão, e
 * recarregar em laço não ajudaria ninguém. Quem trata esse segundo caso é o
 * `LimiteDeErro`.
 */
const MARCA = 'smp_recarga_de_tela';

export function telaSobDemanda(importar) {
  return lazy(() =>
    importar().then(
      (modulo) => {
        try {
          sessionStorage.removeItem(MARCA);
        } catch {
          // Sem sessionStorage (navegação privativa restrita): só perde a marca.
        }
        return modulo;
      },
      (erro) => {
        let jaRecarregou = true;
        try {
          jaRecarregou = sessionStorage.getItem(MARCA) === '1';
          if (!jaRecarregou) sessionStorage.setItem(MARCA, '1');
        } catch {
          // Sem como lembrar que já recarregou, não arrisca o laço.
        }
        if (jaRecarregou) throw erro;

        window.location.reload();
        // Nunca resolve: a página está sendo recarregada, e mostrar um erro
        // por um instante antes disso seria piscar à toa.
        return new Promise(() => {});
      }
    )
  );
}

export { MARCA as MARCA_DE_RECARGA };
