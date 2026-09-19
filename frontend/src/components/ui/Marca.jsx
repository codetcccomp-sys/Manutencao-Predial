/**
 * A marca do sistema: símbolo mais nome.
 *
 * O símbolo é imagem; o nome é texto de verdade, não um pedaço do PNG. Isso
 * não é preciosismo:
 *
 * - O nome escrito em texto é lido por leitor de tela sem depender de `alt`,
 *   é encontrado pelo Ctrl+F, é selecionável e acompanha o tamanho de fonte de
 *   quem aumentou a letra do navegador.
 * - Um PNG do conjunto inteiro teria de vir em duas versões (clara e escura) e
 *   embaçaria em qualquer tamanho que não fosse o exportado.
 *
 * Por isso o símbolo vai com `alt=""`: ele repete o que o texto ao lado já diz.
 * Imagem decorativa com `alt` preenchido faz o leitor de tela anunciar o nome
 * duas vezes seguidas — "Conserva Predial, link, Conserva Predial".
 */

const TAMANHOS = {
  // Cabeçalho: 32px. Grande o bastante para o prédio e a engrenagem se
  // separarem, pequeno o bastante para não empurrar a barra para duas linhas.
  cabecalho: { simbolo: 'h-8', nome: 'text-base', descritor: 'text-[0.7rem]' },
  // Login e telas sem barra: aqui a marca se apresenta.
  destaque: { simbolo: 'h-16', nome: 'text-xl', descritor: 'text-xs' },
};

function Marca({ tamanho = 'cabecalho', invertido = false, comDescritor = false, className = '' }) {
  const t = TAMANHOS[tamanho] ?? TAMANHOS.cabecalho;

  return (
    <span className={`inline-flex items-center gap-2 min-w-0 ${className}`}>
      <img
        src="/marca.png"
        alt=""
        // width/height reservam o espaço antes de a imagem chegar: sem isso o
        // nome ao lado salta quando ela carrega.
        width="256"
        height="231"
        className={`${t.simbolo} w-auto shrink-0`}
      />
      <span className="min-w-0 leading-tight">
        <span className={`block font-bold ${t.nome} ${invertido ? 'text-white' : 'text-navy'}`}>
          Conserva <span className={invertido ? 'text-amber-claro' : 'text-amber'}>Predial</span>
        </span>
        {comDescritor && (
          <span
            className={`block uppercase tracking-wide ${t.descritor} ${
              invertido ? 'text-tinta-clara' : 'text-tinta-2'
            }`}
          >
            Sistema de manutenção
          </span>
        )}
      </span>
    </span>
  );
}

export default Marca;
