/**
 * Prepara um arquivo para virar anexo: reduz a foto antes de enviar.
 *
 * A API recusa acima de 4 MB — e não por gosto: é o teto do corpo de uma
 * função serverless na Vercel (4,5 MB), com folga para o multipart. Só que uma
 * foto de celular de hoje sai do aparelho com 3 a 8 MB. O técnico fotografava
 * o vazamento, escolhia o arquivo, esperava o envio inteiro e recebia "maior
 * que o limite" — sem nada que pudesse fazer no próprio celular para resolver.
 *
 * Reduzir no navegador resolve os dois lados: a foto chega dentro do limite, e
 * chega leve. 1600 px no lado maior mostra uma rachadura ou um disjuntor com
 * folga, e um JPEG nesse tamanho fica em algumas centenas de kB — o que também
 * poupa o banco, que no plano gratuito tem 500 MB para tudo.
 *
 * Nada aqui é obrigatório para o envio funcionar. Se o navegador não souber
 * decodificar o arquivo (um formato que ele não conhece, um navegador antigo
 * sem `createImageBitmap`), o arquivo segue como veio, e quem decide é o
 * servidor, que confere tipo e tamanho de qualquer jeito.
 */

export const LIMITE_BYTES = 4 * 1024 * 1024;
export const LADO_MAXIMO = 1600;
const QUALIDADE = 0.82;

// Abaixo disto a foto já é leve: recodificar só perderia qualidade à toa.
const JA_LEVE_BYTES = 900 * 1024;

const TIPOS_DE_FOTO = new Set(['image/jpeg', 'image/png', 'image/webp']);

function comExtensaoJpg(nome) {
  const base = nome.replace(/\.[^./\\]+$/, '') || 'foto';
  return `${base}.jpg`;
}

function codificar(canvas) {
  return new Promise((resolver) => canvas.toBlob(resolver, 'image/jpeg', QUALIDADE));
}

export async function prepararAnexo(arquivo) {
  if (!TIPOS_DE_FOTO.has(arquivo.type) || arquivo.size <= JA_LEVE_BYTES) return arquivo;
  if (typeof createImageBitmap !== 'function') return arquivo;

  let imagem;
  try {
    // `from-image` aplica a orientação gravada pela câmera (EXIF). Sem isso,
    // a foto tirada com o celular em pé chegava deitada — e o JPEG gerado
    // aqui já não carrega o EXIF para o visualizador corrigir depois.
    imagem = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
  } catch {
    return arquivo;
  }

  try {
    const escala = Math.min(1, LADO_MAXIMO / Math.max(imagem.width, imagem.height));
    const largura = Math.max(1, Math.round(imagem.width * escala));
    const altura = Math.max(1, Math.round(imagem.height * escala));

    const canvas = document.createElement('canvas');
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext('2d');
    if (!ctx) return arquivo;

    // JPEG não tem transparência: sem o fundo branco, o recorte transparente
    // de um PNG viraria preto.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, largura, altura);
    ctx.drawImage(imagem, 0, 0, largura, altura);

    const blob = await codificar(canvas);
    // Recodificar pode, raramente, sair maior (um PNG de poucas cores, por
    // exemplo). Aí o original é melhor em tudo.
    if (!blob || blob.size >= arquivo.size) return arquivo;

    return new File([blob], comExtensaoJpg(arquivo.name), {
      type: 'image/jpeg',
      lastModified: arquivo.lastModified,
    });
  } catch {
    return arquivo;
  } finally {
    imagem.close?.();
  }
}

/**
 * "820 KB", "3,2 MB" — no formato de quem lê, com vírgula decimal.
 *
 * Um só formatador para a lista de anexos e para a mensagem de limite: com
 * dois, a mesma tela dizia "5.0 MB" num lugar e "5 MB" no outro.
 */
export function formatarTamanho(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / 1024 / 1024;
  return `${mb.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}
