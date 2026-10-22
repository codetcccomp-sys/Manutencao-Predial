import { Component } from 'react';
import Aviso from './ui/Aviso';
import Botao from './ui/Botao';

/**
 * Pega o erro de uma tela e diz o que fazer, em vez de deixar a página em branco.
 *
 * Existe por causa das telas sob demanda (`telaSobDemanda`): sem conexão, ou com
 * a rede falhando no meio, o pedaço da tela pode não chegar, e o React desmonta a
 * árvore inteira ao receber um erro que ninguém captura. Aqui o cabeçalho e o
 * menu continuam de pé, e a pessoa tem um botão para tentar de novo.
 *
 * O `key` por caminho (em Layout) zera o erro ao trocar de tela: quem vê esta
 * mensagem e navega para outra tela não fica preso nela.
 */
class LimiteDeErro extends Component {
  state = { erro: null };

  static getDerivedStateFromError(erro) {
    return { erro };
  }

  componentDidCatch(erro) {
    // Só o console: a tela já diz o essencial, e o relatório dos erros de servidor
    // (/operacao/erros) é de quem falha no servidor, não no aparelho de cada um.
    console.error('[tela] não foi possível mostrar a tela:', erro);
  }

  render() {
    if (!this.state.erro) return this.props.children;

    return (
      <div className="grid gap-4">
        <Aviso tipo="erro">
          Não foi possível abrir esta tela. Confira a conexão e tente de novo.
        </Aviso>
        <Botao onClick={() => window.location.reload()} className="justify-self-start">
          Recarregar a página
        </Botao>
      </div>
    );
  }
}

export default LimiteDeErro;
