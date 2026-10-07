import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => ({}) }));

import { destinoSeguro } from '../src/pages/Login';

describe('Para onde o login devolve', () => {
  it('volta ao endereço pedido, com a busca (é o caminho do QR Code)', () => {
    expect(destinoSeguro('/chamados/novo?equipamento=AC-204')).toBe('/chamados/novo?equipamento=AC-204');
  });

  it.each([
    ['outro domínio pela barra dupla', '//malicioso.example/chamados'],
    ['barra invertida, que o navegador lê como barra', '/\\malicioso.example'],
    ['endereço absoluto', 'https://malicioso.example'],
    ['caminho relativo', 'chamados/novo'],
    ['de volta ao próprio login', '/login'],
    ['nada', undefined],
    ['algo que não é texto', { pathname: '/x' }],
  ])('recusa %s e cai no início', (_caso, destino) => {
    expect(destinoSeguro(destino)).toBe('/');
  });
});
