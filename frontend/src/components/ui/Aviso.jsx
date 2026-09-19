import Icone from './Icone';

/**
 * Faixa de retorno ao usuário: erro, sucesso, atenção, informação.
 *
 * Eram dezessete cópias escritas à mão em dez arquivos, e nenhuma tinha
 * `role`. Isso significa que, até aqui, um leitor de tela NÃO anunciava a
 * falha de um formulário: a pessoa apertava "Entrar", nada era dito, e a
 * mensagem ficava desenhada na tela para quem pudesse vê-la.
 *
 * Erro usa `role="alert"` (interrompe e anuncia na hora — quem errou a senha
 * precisa saber antes de digitar de novo). Sucesso e informação usam
 * `role="status"`, que espera a leitura em curso terminar: confirmar algo que
 * já deu certo não justifica atropelar o que a pessoa está ouvindo.
 */

const TIPOS = {
  erro: { cor: 'bg-erro-tenue text-erro', icone: 'alerta', papel: 'alert' },
  sucesso: { cor: 'bg-sucesso-tenue text-sucesso', icone: 'check', papel: 'status' },
  atencao: { cor: 'bg-atencao-tenue text-atencao', icone: 'alerta', papel: 'status' },
  info: { cor: 'bg-info-tenue text-info', icone: 'info', papel: 'status' },
};

function Aviso({ tipo = 'info', titulo, children, className = '' }) {
  const definicao = TIPOS[tipo] ?? TIPOS.info;

  return (
    <div
      role={definicao.papel}
      className={`flex items-start gap-2 rounded p-3 text-sm ${definicao.cor} ${className}`}
    >
      {/* O ícone reforça o tipo para quem não distingue verde de vermelho —
          e o texto continua dizendo tudo sozinho. */}
      <Icone nome={definicao.icone} classe="h-4 w-4 mt-0.5" />
      <div className="min-w-0 flex-1">
        {titulo && <p className="font-medium">{titulo}</p>}
        {children}
      </div>
    </div>
  );
}

export default Aviso;
