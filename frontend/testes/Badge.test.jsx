import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { BadgeAtraso, BadgeEstado, BadgePrioridade } from '../src/components/ui/Badge';
import {
  ESTADOS,
  ORDEM_ESTADOS,
  ORDEM_PRIORIDADES,
  PRIORIDADES,
} from '../src/dominio/rotulos';

describe('Badge de estado', () => {
  it.each(ORDEM_ESTADOS)('%s aparece escrito, não só colorido', (estado) => {
    render(<BadgeEstado estado={estado} />);
    expect(screen.getByText(ESTADOS[estado].rotulo)).toBeInTheDocument();
  });

  it('todo estado carrega ícone além do texto e da cor', () => {
    for (const estado of ORDEM_ESTADOS) {
      const { container, unmount } = render(<BadgeEstado estado={estado} />);
      // O ícone é decorativo (aria-hidden) porque o texto ao lado já diz o
      // que é — mas precisa existir: é o canal que sobra para quem imprime
      // em preto e branco ou não distingue as cores.
      expect(container.querySelector('svg')).not.toBeNull();
      unmount();
    }
  });

  /**
   * Este é o teste que teria pego o defeito original.
   *
   * `atribuido` e `em_andamento` usavam literalmente o mesmo par de cor —
   * `bg-blue-100 text-blue-700` nos dois. Dois estados diferentes do fluxo,
   * visualmente idênticos, mesmo para quem enxerga cor perfeitamente.
   */
  it('nenhum par de estados é indistinguível', () => {
    const vistos = new Map();

    for (const estado of ORDEM_ESTADOS) {
      const { cor, icone } = ESTADOS[estado];
      const assinatura = `${cor}|${icone}`;

      expect(
        vistos.has(assinatura),
        `"${estado}" tem a mesma cor e o mesmo ícone de "${vistos.get(assinatura)}" — ` +
          'os dois estados ficariam indistinguíveis na tela'
      ).toBe(false);

      vistos.set(assinatura, estado);
    }
  });

  it('estados que compartilham cor se separam pelo ícone', () => {
    // Triagem e aguardando material são âmbar de propósito: os dois são
    // espera. O que os separa é a forma, e isso precisa continuar verdade.
    expect(ESTADOS.em_triagem.cor).toBe(ESTADOS.aguardando_material.cor);
    expect(ESTADOS.em_triagem.icone).not.toBe(ESTADOS.aguardando_material.icone);
  });

  it('estado desconhecido aparece cru em vez de sumir', () => {
    render(<BadgeEstado estado="estado_que_o_front_nao_conhece" />);
    // Um espaço em branco no lugar do estado seria pior: ninguém saberia se o
    // chamado está sem estado ou se a tela quebrou.
    expect(screen.getByText('estado_que_o_front_nao_conhece')).toBeInTheDocument();
  });
});

describe('Badge de prioridade', () => {
  it.each(ORDEM_PRIORIDADES)('%s aparece escrita', (prioridade) => {
    render(<BadgePrioridade prioridade={prioridade} />);
    expect(screen.getByText(PRIORIDADES[prioridade].rotulo)).toBeInTheDocument();
  });

  it('a escada de barras cresce com a gravidade', () => {
    for (const prioridade of ORDEM_PRIORIDADES) {
      const { container, unmount } = render(<BadgePrioridade prioridade={prioridade} />);
      const cheias = [...container.querySelectorAll('rect')].filter(
        (r) => r.getAttribute('opacity') === '1'
      );

      // A quantidade de barras acesas é a informação: funciona sem cor e sem
      // ler o texto, que é o que um símbolo único (chama, exclamação) não dá.
      expect(cheias).toHaveLength(PRIORIDADES[prioridade].nivel);
      unmount();
    }
  });

  it('a escala inteira fica visível, não só o nível atingido', () => {
    const { container } = render(<BadgePrioridade prioridade="alta" />);
    // Quatro barras sempre: dá para ver que "alta" é três de quatro, e não
    // três de três.
    expect(container.querySelectorAll('rect')).toHaveLength(4);
  });

  it('cada prioridade tem cor própria', () => {
    const cores = ORDEM_PRIORIDADES.map((p) => PRIORIDADES[p].cor);
    expect(new Set(cores).size).toBe(cores.length);
  });
});

describe('Badge de atraso', () => {
  it('é separado do estado, porque atraso não é estado', () => {
    render(
      <>
        <BadgeEstado estado="em_andamento" />
        <BadgeAtraso />
      </>
    );

    // Um chamado atrasado continua em andamento. Fundir as duas coisas num
    // badge só esconderia uma delas.
    expect(screen.getByText('Em andamento')).toBeInTheDocument();
    expect(screen.getByText('Em atraso')).toBeInTheDocument();
  });
});
