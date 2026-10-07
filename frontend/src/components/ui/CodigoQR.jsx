import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/**
 * QR Code desenhado em SVG pelo próprio React.
 *
 * Sem `innerHTML` e sem imagem gerada: a biblioteca só calcula a matriz, e o
 * desenho é um <path> comum. Assim a CSP estrita (sem 'unsafe-inline') não tem
 * nada a bloquear, e a etiqueta impressa sai nítida em qualquer tamanho —
 * vetor não pixeliza na impressora.
 *
 * Correção de erro "M" (15%): aguenta uma etiqueta um pouco riscada ou
 * desbotada pelo sol, sem deixar o código denso demais para a câmera de um
 * celular simples ler a meio metro.
 */
const MARGEM = 4; // A "zona quieta" que a norma do QR pede em volta, em módulos.

export function matrizQR(texto) {
  const qr = qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount();
  const escuros = [];
  for (let linha = 0; linha < n; linha++) {
    for (let coluna = 0; coluna < n; coluna++) {
      if (qr.isDark(linha, coluna)) escuros.push([coluna, linha]);
    }
  }
  return { n, escuros };
}

function CodigoQR({ texto, tamanho = 160, rotulo, className = '' }) {
  const { n, escuros } = useMemo(() => matrizQR(texto), [texto]);
  const lado = n + MARGEM * 2;
  const caminho = escuros.map(([x, y]) => `M${x + MARGEM} ${y + MARGEM}h1v1h-1z`).join('');

  return (
    <svg
      role="img"
      aria-label={rotulo ?? `QR Code: ${texto}`}
      width={tamanho}
      height={tamanho}
      viewBox={`0 0 ${lado} ${lado}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={lado} height={lado} fill="#ffffff" />
      <path d={caminho} fill="#000000" />
    </svg>
  );
}

export default CodigoQR;
