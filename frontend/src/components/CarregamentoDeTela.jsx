import { Component, Suspense } from 'react';
import Aviso from './ui/Aviso';
import Botao from './ui/Botao';
import { Esqueleto, Regiao } from './ui/Estados';

/**
 * Envoltório das telas que carregam sob demanda (React.lazy, em App.jsx e
 * Inicio.jsx): a espera enquanto o pedaço de código chega e o que dizer quando
 * ele não chega.
 *
 * O pedaço pode não chegar por dois motivos, e a pessoa só consegue agir sobre
 * um deles: ela está sem conexão e nunca abriu aquela tela neste aparelho (o
 * service worker só guarda o que já foi aberto), ou o sistema foi atualizado
 * com a tela aberta e o arquivo antigo deixou de existir. Nos dois casos o
 * texto diz o que fazer, em vez de deixar a tela em branco.
 *
 * "Recarregar" é uma recarga completa da página, e não uma nova tentativa de
 * renderizar: o React.lazy guarda a promessa rejeitada, então renderizar de
 * novo repetiria o erro sem pedir o arquivo outra vez. A recarga passa pela
 * rede primeiro (sw.js) e traz o index.html novo, com os nomes certos.
 */

// Cada navegador diz isso de um jeito: Chrome "Failed to fetch dynamically
// imported module", Firefox "error loading dynamically imported module", Safari
// "Importing a module script failed". O Vite, ao pré-carregar, usa "Unable to
// preload CSS".
const FALHA_DE_CARREGAMENTO = /dynamically imported module|Importing a module script failed|Unable to preload|ChunkLoadError/i;

export function ehFalhaDeCarregamento(erro) {
  return FALHA_DE_CARREGAMENTO.test(`${erro?.name ?? ''} ${erro?.message ?? ''}`);
}

class FalhaDeCarregamento extends Component {
  state = { erro: null };

  static getDerivedStateFromError(erro) {
    return { erro };
  }

  componentDidCatch(erro) {
    // Só o carregamento de código tem tela própria. Qualquer outro erro de
    // renderização segue o caminho de antes, sem ser engolido por um aviso que
    // sugere recarregar e repetiria o erro.
    if (ehFalhaDeCarregamento(erro)) console.error('[tela] não foi possível carregar:', erro);
  }

  render() {
    const { erro } = this.state;
    if (!erro) return this.props.children;
    if (!ehFalhaDeCarregamento(erro)) throw erro;

    const semConexao = typeof navigator !== 'undefined' && navigator.onLine === false;

    return (
      <div className="grid max-w-xl gap-4">
        <Aviso tipo="erro" titulo="Não foi possível abrir esta tela">
          {semConexao
            ? 'Esta tela precisa de conexão na primeira vez em que é aberta neste aparelho. Conecte-se e tente de novo.'
            : 'O sistema pode ter sido atualizado enquanto você usava. Recarregue a página para abrir a versão nova.'}
        </Aviso>
        <div>
          <Botao variante="primaria" onClick={() => window.location.reload()}>
            Recarregar a página
          </Botao>
        </div>
      </div>
    );
  }
}

function CarregamentoDeTela({ children }) {
  return (
    <FalhaDeCarregamento>
      <Suspense
        fallback={
          <Regiao carregando rotuloCarregando="Carregando a tela...">
            <Esqueleto linhas={3} />
          </Regiao>
        }
      >
        {children}
      </Suspense>
    </FalhaDeCarregamento>
  );
}

export default CarregamentoDeTela;
