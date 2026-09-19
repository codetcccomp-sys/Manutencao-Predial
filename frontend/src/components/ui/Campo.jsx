import { useId } from 'react';

/**
 * Campo de formulário: rótulo, controle, ajuda e erro, ligados entre si.
 *
 * O sistema tinha dezoito cópias de `border rounded px-3 py-2` e o par
 * htmlFor/id só em algumas telas — nas outras, o rótulo ficava desenhado ao
 * lado do campo sem estar associado a ele, e quem usa leitor de tela ouvia
 * "caixa de edição" sem saber do quê.
 *
 * SOBRE A MARCAÇÃO DE OBRIGATORIEDADE
 *
 * O "(opcional)" fica FORA do elemento <label>, como irmão. Parece detalhe e
 * não é: o texto do rótulo é o nome acessível do campo, é por ele que leitor
 * de tela e testes encontram o controle, e pendurar um asterisco ou um
 * "(opcional)" ali dentro renomeia o campo. "Título" viraria "Título
 * (opcional)".
 *
 * E marca-se o opcional, não o obrigatório: neste sistema quase todo campo é
 * obrigatório, então marcar a minoria é menos ruído — e o formulário diz a
 * regra uma vez, em vez de repetir um asterisco em cada linha.
 */

const CONTROLE =
  'w-full min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm ' +
  'text-tinta placeholder:text-tinta-2 disabled:bg-fundo disabled:cursor-not-allowed ' +
  'aria-[invalid=true]:border-erro';

function Envolucro({ id, rotulo, opcional, ajuda, erro, children }) {
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline gap-1.5">
        <label htmlFor={id} className="text-sm font-medium text-tinta">
          {rotulo}
        </label>
        {opcional && <span className="text-xs text-tinta-2">(opcional)</span>}
      </div>

      {ajuda && (
        <p id={`${id}-ajuda`} className="text-xs text-tinta-2">
          {ajuda}
        </p>
      )}

      {children}

      {/*
        O erro fica junto do campo e é anunciado quando aparece. Antes as
        mensagens iam todas para uma faixa no topo da tela: quem errou um
        campo no meio de um formulário longo recebia o aviso fora da vista,
        sem nada dizendo qual campo.
      */}
      {erro && (
        <p id={`${id}-erro`} role="alert" className="text-xs font-medium text-erro">
          {erro}
        </p>
      )}
    </div>
  );
}

/** Liga ajuda e erro ao controle, para o leitor de tela lê-los junto. */
function descricao(id, ajuda, erro) {
  const partes = [ajuda && `${id}-ajuda`, erro && `${id}-erro`].filter(Boolean);
  return partes.length ? partes.join(' ') : undefined;
}

export function Campo({ rotulo, opcional = false, ajuda, erro, id, className = '', ...resto }) {
  const gerado = useId();
  const idCampo = id ?? gerado;

  return (
    <Envolucro id={idCampo} rotulo={rotulo} opcional={opcional} ajuda={ajuda} erro={erro}>
      <input
        id={idCampo}
        required={!opcional}
        aria-invalid={erro ? true : undefined}
        aria-describedby={descricao(idCampo, ajuda, erro)}
        className={`${CONTROLE} ${className}`}
        {...resto}
      />
    </Envolucro>
  );
}

export function AreaDeTexto({ rotulo, opcional = false, ajuda, erro, id, className = '', ...resto }) {
  const gerado = useId();
  const idCampo = id ?? gerado;

  return (
    <Envolucro id={idCampo} rotulo={rotulo} opcional={opcional} ajuda={ajuda} erro={erro}>
      <textarea
        id={idCampo}
        required={!opcional}
        aria-invalid={erro ? true : undefined}
        aria-describedby={descricao(idCampo, ajuda, erro)}
        className={`${CONTROLE} ${className}`}
        {...resto}
      />
    </Envolucro>
  );
}

export function Selecao({
  rotulo,
  opcional = false,
  ajuda,
  erro,
  id,
  className = '',
  children,
  ...resto
}) {
  const gerado = useId();
  const idCampo = id ?? gerado;

  return (
    <Envolucro id={idCampo} rotulo={rotulo} opcional={opcional} ajuda={ajuda} erro={erro}>
      {/*
        min-w-0 e w-full no select não são zelo: a largura natural de um
        <select> é a da opção mais longa, e uma lista de locais com o caminho
        hierárquico inteiro ("Prédio Central / A / 1º andar / Sala 101")
        esticava o formulário e levava a página junto no celular.
      */}
      <select
        id={idCampo}
        required={!opcional}
        aria-invalid={erro ? true : undefined}
        aria-describedby={descricao(idCampo, ajuda, erro)}
        className={`${CONTROLE} ${className}`}
        {...resto}
      >
        {children}
      </select>
    </Envolucro>
  );
}

export default Campo;
