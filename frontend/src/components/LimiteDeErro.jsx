import { Component } from 'react';
import Aviso from './ui/Aviso';
import Botao from './ui/Botao';
import { registrarErro } from '../monitoramento';

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
    // O console, para quem está com o aparelho na mão, e um aviso à administração (tela pelo MODELO da
    // rota, mensagem sem e-mail, ninguém identificado): sem isto o defeito de uma tela só chegava a quem
    // o via, e quem o via raramente escrevia (monitoramento/telemetria.js).
    console.error('[tela] não foi possível mostrar a tela:', erro);
    registrarErro(erro);
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
        {/* Link comum, e não do roteador: esta tela aparece quando algo já quebrou, e uma
            navegação completa recomeça o aplicativo do zero. */}
        <p className="text-sm text-tinta-2">
          Se o problema continuar, veja{' '}
          <a href="/suporte" className="font-medium text-navy underline">
            ajuda e suporte
          </a>
          .
        </p>
      </div>
    );
  }
}

export default LimiteDeErro;
