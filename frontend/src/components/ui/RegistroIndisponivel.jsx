import Botao from './Botao';
import LinkVoltar from './LinkVoltar';

/**
 * A tela de um registro (chamado, equipamento) que não pôde ser aberto.
 *
 * Era uma caixa vermelha solta, "Não foi possível carregar o chamado.", igual
 * para quatro situações que pedem saídas diferentes: endereço errado, chamado de
 * outra pessoa, aparelho sem conexão e falha do servidor. Sem título (a tela
 * ficava sem `h1`, e o foco da troca de rota não tinha onde pousar), sem dizer a
 * causa e sem caminho de volta: quem chegava por um link antigo ficava parado.
 *
 * Cada causa diz o que houve e o que dá para fazer. "Tentar de novo" só aparece
 * onde tentar pode mudar o resultado (rede e servidor); repetir um 404 ou um 403
 * devolveria a mesma tela.
 */

/** A causa, lida do erro do cliente da API (`status: 0` é o que ele põe quando não há rede). */
export function causaDaFalha(erro) {
  const status = erro?.response?.status;
  if (status === 404) return 'nao_encontrado';
  if (status === 403) return 'sem_acesso';
  if (!status) return 'sem_conexao';
  return 'falha';
}

const TEXTOS = {
  chamado: {
    nao_encontrado: [
      'Chamado não encontrado',
      'Não existe chamado neste endereço. Confira o link ou procure pelo protocolo na lista de chamados.',
    ],
    sem_acesso: [
      'Você não tem acesso a este chamado',
      'Ele foi aberto por outra pessoa ou está com outra equipe. Se deveria aparecer para você, fale com a gestão.',
    ],
    sem_conexao: [
      'Não foi possível abrir o chamado',
      'O aparelho está sem conexão e este chamado ainda não tinha sido aberto nele. Tente de novo quando a conexão voltar.',
    ],
    falha: ['Não foi possível abrir o chamado', 'Houve uma falha ao carregar. Tente de novo em instantes.'],
  },
  equipamento: {
    nao_encontrado: [
      'Equipamento não encontrado',
      'Não existe equipamento neste endereço. Confira o link ou a etiqueta, ou procure na lista de equipamentos.',
    ],
    sem_acesso: ['Você não tem acesso a este equipamento', 'A ficha do equipamento é da gestão e dos técnicos.'],
    sem_conexao: [
      'Não foi possível abrir o equipamento',
      'O aparelho está sem conexão. Tente de novo quando a conexão voltar.',
    ],
    falha: ['Não foi possível abrir o equipamento', 'Houve uma falha ao carregar. Tente de novo em instantes.'],
  },
};

const PODE_REPETIR = ['sem_conexao', 'falha'];

function RegistroIndisponivel({ oQue = 'chamado', causa = 'falha', aoTentarDeNovo, voltarPara = '/', rotuloVoltar }) {
  const [titulo, descricao] = (TEXTOS[oQue] ?? TEXTOS.chamado)[causa] ?? TEXTOS.chamado.falha;

  return (
    <div className="grid gap-4">
      <LinkVoltar para={voltarPara}>{rotuloVoltar}</LinkVoltar>
      {/* role="alert": quem usa leitor de tela ouve o que houve assim que a tela troca. */}
      <div role="alert" className="grid gap-3 rounded-lg border border-borda bg-superficie p-6 shadow-sm">
        <h1 className="text-lg font-bold text-navy">{titulo}</h1>
        <p className="max-w-2xl text-sm text-tinta-2">{descricao}</p>
        {aoTentarDeNovo && PODE_REPETIR.includes(causa) && (
          <div>
            <Botao variante="primaria" onClick={aoTentarDeNovo}>
              Tentar de novo
            </Botao>
          </div>
        )}
      </div>
    </div>
  );
}

export default RegistroIndisponivel;
