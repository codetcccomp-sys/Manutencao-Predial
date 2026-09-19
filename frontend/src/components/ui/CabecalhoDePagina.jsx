/**
 * Título da tela.
 *
 * Usa <h1>, e a mudança não é cosmética: as telas internas começavam em <h2>
 * sem que houvesse <h1> nenhum na página. Quem navega por cabeçalhos — atalho
 * comum de leitor de tela — encontrava uma árvore que começa no segundo nível
 * e não tem raiz.
 *
 * O nome do sistema, no cabeçalho azul, é um link de volta ao início, não o
 * título da página. O título é o que esta tela é.
 */
function CabecalhoDePagina({ titulo, descricao, acao, className = '' }) {
  return (
    <div
      className={`flex flex-col gap-3 mb-6 sm:flex-row sm:items-start sm:justify-between ${className}`}
    >
      <div className="min-w-0">
        <h1 className="text-lg font-bold text-navy">{titulo}</h1>
        {descricao && <p className="text-sm text-tinta-2 mt-1 max-w-2xl">{descricao}</p>}
      </div>
      {acao && <div className="shrink-0">{acao}</div>}
    </div>
  );
}

export default CabecalhoDePagina;
