/**
 * Superfície de conteúdo.
 *
 * Havia doze variações de `bg-white rounded-lg shadow-sm p-6 grid gap-3`
 * espalhadas, com sombras e preenchimentos que não batiam entre si.
 *
 * O que separa o cartão do fundo agora é a BORDA, não a sombra. Sombra forte
 * diz "isto flutua sobre o resto" — verdade para um menu suspenso, mentira
 * para um bloco de conteúdo parado na página. Com dez cartões empilhados, dez
 * sombras marcadas viram ruído e nenhuma hierarquia.
 */
function Cartao({ titulo, descricao, acao, className = '', children, ...resto }) {
  return (
    <section
      className={`bg-superficie rounded-lg border border-borda shadow-sm p-6 min-w-0 ${className}`}
      {...resto}
    >
      {(titulo || acao) && (
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            {titulo && <h3 className="font-medium text-navy">{titulo}</h3>}
            {descricao && <p className="text-xs text-tinta-2 mt-0.5">{descricao}</p>}
          </div>
          {acao && <div className="shrink-0">{acao}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export default Cartao;
