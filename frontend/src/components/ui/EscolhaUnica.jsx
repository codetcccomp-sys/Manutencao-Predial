import { useId } from 'react';

/**
 * Pergunta com uma resposta só, em grupo de opções visíveis.
 *
 * `<fieldset>` com `<legend>` é o que dá nome ao grupo para o leitor de tela ("Alguém
 * pode se machucar…, grupo, Não, 1 de 4"). Cada opção é um rádio nativo dentro de um
 * `<label>` que ocupa a linha inteira: o alvo de toque tem 44 px de altura, e não os
 * poucos pixels do círculo. Nenhuma opção vem marcada, e o `required` nativo impede
 * enviar sem responder.
 */
export default function EscolhaUnica({ pergunta, opcoes, valor, onChange, ajuda }) {
  const nome = useId();

  return (
    <fieldset className="grid gap-1 min-w-0">
      <legend className="text-sm font-medium text-tinta">{pergunta}</legend>
      {ajuda && <p className="text-xs text-tinta-2">{ajuda}</p>}

      <div className="grid gap-2 sm:grid-cols-2 mt-1">
        {opcoes.map((opcao) => (
          <label
            key={opcao.valor}
            className="flex min-h-11 items-center gap-3 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm text-tinta cursor-pointer has-[:checked]:border-navy has-[:checked]:bg-superficie-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-navy"
          >
            <input
              type="radio"
              name={nome}
              value={opcao.valor}
              checked={String(valor) === String(opcao.valor)}
              onChange={() => onChange(opcao.valor)}
              required
              className="h-4 w-4 shrink-0 accent-navy"
            />
            <span>{opcao.texto}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
