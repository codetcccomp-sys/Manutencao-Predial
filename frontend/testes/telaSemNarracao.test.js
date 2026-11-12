import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * O título da tela não ganha subtítulo explicativo.
 *
 * As telas tinham, debaixo do título, uma frase dizendo para que serviam ("Nada aqui é
 * apagado...", "Os recortes respeitam o período..."). Sistema de empresa não narra a si
 * mesmo: quem usa todo dia lê a frase uma vez e depois só tropeça nela (pedido do dono do
 * projeto, 12/11/2026). Debaixo do título só entra DADO da tela (o nome e o e-mail em Minha
 * conta, o código do equipamento, quantos chamados estão na fila), escrito como expressão.
 *
 * Texto que a pessoa precisa para agir continua onde ela age: ajuda do campo (`ajuda` do
 * Campo), consequência ao lado do botão, estado vazio, erro.
 */
const SRC = resolve(process.cwd(), 'src');

const arquivos = (dir) =>
  readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return caminho.endsWith('.jsx') ? [caminho] : [];
  });

describe('Telas sem narração', () => {
  it('nenhum título de tela traz frase fixa como descrição', () => {
    const narrados = [];
    for (const arquivo of arquivos(SRC)) {
      const codigo = readFileSync(arquivo, 'utf8');
      // Cada uso do cabeçalho até o fim da tag de abertura.
      for (const [tag] of codigo.matchAll(/<CabecalhoDePagina\b[\s\S]*?\/?>/g)) {
        // Frase fixa: `descricao="..."` ou `descricao={'...'}`. Dado vem como expressão.
        if (/\bdescricao\s*=\s*(["']|\{\s*["'])/.test(tag)) {
          narrados.push(relative(SRC, arquivo));
        }
      }
    }

    expect(narrados).toEqual([]);
  });
});
