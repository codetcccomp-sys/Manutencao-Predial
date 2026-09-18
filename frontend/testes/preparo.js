import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  // Sem isto, a árvore de um teste sobrevive para o seguinte e uma busca por
  // texto acha o elemento do teste anterior — o pior tipo de falso positivo,
  // porque passa.
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

// jsdom não implementa nenhum dos dois, e ambos aparecem no caminho de
// download de arquivo (relatórios e anexos).
if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => 'blob:teste');
  URL.revokeObjectURL = vi.fn();
}
