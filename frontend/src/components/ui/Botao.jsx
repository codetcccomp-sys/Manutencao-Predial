/**
 * Botão.
 *
 * Havia quatro variantes escritas à mão pelas telas, com sombras, opacidades e
 * tamanhos que não combinavam entre si — e o botão principal do sistema,
 * "+ Novo chamado", com branco sobre âmbar a 2,71:1.
 *
 * A ação primária agora é navy (11,62:1). O âmbar virou o semântico de
 * atenção e não é mais cor de ação: quando tudo em destaque é âmbar, nada em
 * âmbar chama atenção.
 */

const VARIANTES = {
  // Uma por tela, no máximo. É a ação que a pessoa veio fazer.
  primaria: 'bg-navy text-white hover:bg-navy-2',

  // Tudo o mais que é ação de verdade mas não a principal.
  secundaria: 'bg-superficie text-navy border border-borda-forte hover:bg-fundo',

  // Cancelar, desativar, remover. Vermelho é o último canal — o verbo no
  // rótulo tem de dizer sozinho o que vai acontecer.
  perigo: 'bg-superficie text-erro border border-erro/40 hover:bg-erro-tenue',

  // Ação terciária, dentro de listas e linhas de tabela.
  discreta: 'text-navy hover:bg-fundo',
};

const TAMANHOS = {
  // py-2.5 em vez de py-2: 40px de altura, perto do alvo confortável sem
  // parecer inchado no desktop. `alvo-toque` completa os 44px no celular.
  md: 'px-4 py-2.5 text-sm',
  sm: 'px-3 py-1.5 text-sm',
};

const BASE =
  'alvo-toque inline-flex items-center justify-center gap-2 rounded font-medium ' +
  'transition-colors disabled:opacity-60 disabled:cursor-not-allowed';

function Botao({
  variante = 'secundaria',
  tamanho = 'md',
  carregando = false,
  larguraTotal = false,
  className = '',
  children,
  ...resto
}) {
  return (
    <button
      // Sem `type`, um botão dentro de formulário envia o formulário — e foi
      // assim que botões de "Cancelar" já submeteram formulário por aí. Quem
      // quer enviar pede explicitamente.
      type="button"
      disabled={carregando || resto.disabled}
      // Avisa o leitor de tela que a ação está em curso, o que um rótulo
      // trocado para "Enviando..." não comunica de forma padronizada.
      aria-busy={carregando || undefined}
      {...resto}
      className={`${BASE} ${VARIANTES[variante]} ${TAMANHOS[tamanho]} ${
        larguraTotal ? 'w-full' : ''
      } ${className}`}
    >
      {children}
    </button>
  );
}

export default Botao;
