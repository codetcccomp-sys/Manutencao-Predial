import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CURVA, gsap, reduzMovimento } from '../../animacao/movimento';

/**
 * Gráfico de linhas por dia, em SVG puro.
 *
 * Uma biblioteca de gráficos custaria mais peso no pacote do que o próprio código
 * que se escreve aqui: são duas linhas, uma área, uma grade e uma dica. O que
 * importa fica visível no arquivo, e a CSP estrita não precisa de exceção nenhuma
 * (o SVG usa atributos, e a animação do GSAP escreve por CSSOM).
 *
 * Decisões que não são óbvias:
 *
 * - **A revelação é um recorte que cresce da esquerda, não o truque do
 *   `stroke-dashoffset`.** O truque anima UMA linha por vez e quebra qualquer
 *   traço tracejado, e este gráfico tem duas séries e uma área. O recorte revela
 *   tudo junto e funciona com qualquer estilo de traço.
 *
 * - **A animação depende dos DADOS, não da largura.** Redimensionar a janela
 *   refaz as coordenadas, mas replay de animação a cada arrastar de borda seria
 *   enjoativo e custoso.
 *
 * - **Acessível sem mouse.** O contêiner recebe foco e as setas percorrem os dias;
 *   a leitura do dia ativo vai para uma região `aria-live`. O SVG é decorativo
 *   (`aria-hidden`) e a descrição fica em texto: um gráfico que só se entende com
 *   os olhos e o mouse não serve a quem usa leitor de tela nem a quem está no
 *   celular, onde "passar o mouse" não existe.
 *
 * - **A dica só é lida em voz alta pelo teclado.** O mouse passa por dezenas de
 *   dias por segundo, e anunciar cada um transformaria o leitor de tela numa
 *   metralhadora.
 */

const MARGEM = { topo: 12, direita: 14, base: 26, esquerda: 34 };

const PASSOS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];

/** Escala vertical com degraus inteiros: não existe "2,5 chamados". */
export function escalaVertical(maximo) {
  const alvo = Math.max(1, maximo);
  const passo = PASSOS.find((p) => alvo / p <= 4) ?? Math.ceil(alvo / 4);
  const topo = Math.ceil(alvo / passo) * passo;
  const marcas = [];
  for (let v = 0; v <= topo; v += passo) marcas.push(v);
  return { topo, marcas };
}

const ddmm = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

const porExtenso = (dia) =>
  new Date(`${dia}T12:00:00`).toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });

function useLargura(ref, inicial = 640) {
  const [largura, setLargura] = useState(inicial);

  useLayoutEffect(() => {
    const elemento = ref.current;
    if (!elemento) return undefined;

    const medir = () => {
      const w = Math.round(elemento.getBoundingClientRect().width);
      if (w > 0) setLargura(w);
    };
    medir();

    // O jsdom não tem ResizeObserver; ali a largura inicial basta.
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observador = new ResizeObserver(medir);
    observador.observe(elemento);
    return () => observador.disconnect();
  }, [ref]);

  return largura;
}

/**
 * @param dias    [{ dia: 'AAAA-MM-DD', abertos, concluidos }, ...], em ordem
 * @param series  [{ chave, rotulo, cor }]; `cor` é o nome de um token (navy, sucesso)
 */
function GraficoDeLinhas({ dias, series, titulo }) {
  const caixa = useRef(null);
  const recorte = useRef(null);
  const idRecorte = useId().replace(/:/g, '');
  const largura = useLargura(caixa);
  const [ativo, setAtivo] = useState(null);
  const [anunciar, setAnunciar] = useState('');

  const altura = largura < 480 ? 200 : 240;
  const internaW = Math.max(1, largura - MARGEM.esquerda - MARGEM.direita);
  const internaH = altura - MARGEM.topo - MARGEM.base;
  const n = dias.length;

  const { topo, marcas } = useMemo(
    () => escalaVertical(Math.max(0, ...dias.flatMap((d) => series.map((s) => d[s.chave])))),
    [dias, series]
  );

  const x = (i) => MARGEM.esquerda + (n <= 1 ? internaW / 2 : (i / (n - 1)) * internaW);
  const y = (v) => MARGEM.topo + internaH - (v / topo) * internaH;

  const caminho = (chave) => dias.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d[chave]).toFixed(1)}`).join(' ');
  const area = (chave) =>
    n < 2
      ? ''
      : `${caminho(chave)} L${x(n - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;

  // A largura vigente numa ref, para a animação ler o valor DE AGORA a cada quadro.
  const larguraAtual = useRef(largura);
  larguraAtual.current = largura;

  // A revelação roda quando OS DADOS mudam (ver o comentário do componente).
  //
  // Anima um PROGRESSO de 0 a 1 e aplica `progresso × largura atual`, e não uma
  // largura-alvo fixa. O gráfico nasce com 640 e mede a largura real logo depois; uma
  // animação que capturasse o 640 como alvo terminaria ali, e o recorte pararia na
  // metade de um gráfico de 1200px — a linha nunca chegaria ao dia de hoje. O teste
  // anterior só exigia "largura final > 200", e não pegou.
  useLayoutEffect(() => {
    const retangulo = recorte.current;
    if (!retangulo || reduzMovimento() || n === 0) return undefined;

    const progresso = { p: 0 };
    const aplicar = () => retangulo.setAttribute('width', String(progresso.p * larguraAtual.current));
    const completar = () => retangulo.setAttribute('width', String(larguraAtual.current));

    aplicar();
    const animacao = gsap.to(progresso, {
      p: 1,
      duration: 1,
      ease: CURVA,
      onUpdate: aplicar,
      onComplete: completar,
    });
    return () => {
      animacao.kill();
      completar();
    };
    // Só `dias`: a largura muda as coordenadas, e não deve reiniciar a animação.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dias]);

  const total = (chave) => dias.reduce((soma, d) => soma + d[chave], 0);
  const semDados = n === 0 || series.every((s) => total(s.chave) === 0);

  function indiceDoPonteiro(evento) {
    const medidas = caixa.current.getBoundingClientRect();
    const posicao = evento.clientX - medidas.left - MARGEM.esquerda;
    if (n <= 1) return 0;
    return Math.min(n - 1, Math.max(0, Math.round((posicao / internaW) * (n - 1))));
  }

  function aoTeclar(evento) {
    const limites = { Home: 0, End: n - 1 };
    let proximo = ativo;

    if (evento.key === 'ArrowLeft') proximo = Math.max(0, (ativo ?? n) - 1);
    else if (evento.key === 'ArrowRight') proximo = Math.min(n - 1, (ativo ?? -1) + 1);
    else if (evento.key in limites) proximo = limites[evento.key];
    else if (evento.key === 'Escape') {
      setAtivo(null);
      return;
    } else return;

    evento.preventDefault();
    setAtivo(proximo);
    const d = dias[proximo];
    setAnunciar(
      `${porExtenso(d.dia)}: ${series.map((s) => `${d[s.chave]} ${s.rotulo.toLowerCase()}`).join(', ')}`
    );
  }

  const resumo = semDados
    ? 'Nenhum chamado no período.'
    : `De ${porExtenso(dias[0].dia)} a ${porExtenso(dias[n - 1].dia)}: ${series
        .map((s) => `${total(s.chave)} ${s.rotulo.toLowerCase()}`)
        .join(', ')}.`;

  if (semDados) {
    return (
      <p className="rounded-lg border border-dashed border-borda-forte px-6 py-10 text-center text-sm text-tinta-2">
        Nenhum chamado neste período.
      </p>
    );
  }

  const dia = ativo === null ? null : dias[ativo];
  const dicaX = ativo === null ? 0 : x(ativo);
  // A dica não passa da borda: perto do fim ela abre para a esquerda do ponto.
  const dicaParaEsquerda = dicaX > largura * 0.6;

  // `min-w-0` na cadeia inteira de itens de grade: sem ele o item não encolhe abaixo da
  // largura do SVG (640 no primeiro quadro, antes de medir), a página inteira alarga no
  // celular e a medição confirma o tamanho errado — o contêiner mede o que o próprio
  // gráfico o obrigou a ser.
  return (
    <div className="grid min-w-0 gap-3">
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-tinta-2">
        {series.map((s, k) => (
          <li key={s.chave} className="flex items-center gap-1.5">
            {/* A amostra imita o traço do gráfico: a segunda série é tracejada, e a cor
                sozinha não distingue duas linhas para quem não separa verde de azul. */}
            <span
              className={`inline-block w-5 border-t-2 ${k === 1 ? 'border-dashed' : 'border-solid'} ${
                s.cor === 'sucesso' ? 'border-sucesso' : 'border-navy'
              }`}
            />
            {s.rotulo}: <strong className="text-tinta">{total(s.chave)}</strong>
          </li>
        ))}
      </ul>

      <div
        ref={caixa}
        role="group"
        aria-label={`${titulo}. ${resumo} Use as setas para percorrer os dias.`}
        tabIndex={0}
        onKeyDown={aoTeclar}
        onBlur={() => setAtivo(null)}
        onPointerMove={(e) => setAtivo(indiceDoPonteiro(e))}
        onPointerDown={(e) => setAtivo(indiceDoPonteiro(e))}
        // No toque, levantar o dedo dispara "leave": a dica sumiria no instante em que a
        // pessoa foi ler. Só o mouse a esconde ao sair; no toque, tocar fora (blur) fecha.
        onPointerLeave={(e) => e.pointerType === 'mouse' && setAtivo(null)}
        className="relative min-w-0 touch-pan-y select-none rounded"
      >
        <svg width={largura} height={altura} viewBox={`0 0 ${largura} ${altura}`} aria-hidden="true" focusable="false">
          <defs>
            <clipPath id={idRecorte}>
              <rect ref={recorte} x="0" y="0" width={largura} height={altura} />
            </clipPath>
          </defs>

          {marcas.map((v) => (
            <g key={v}>
              <line
                x1={MARGEM.esquerda}
                x2={largura - MARGEM.direita}
                y1={y(v)}
                y2={y(v)}
                className="stroke-borda"
                strokeWidth="1"
              />
              <text x={MARGEM.esquerda - 6} y={y(v) + 3} textAnchor="end" className="fill-tinta-2 text-[10px]">
                {v}
              </text>
            </g>
          ))}

          {rotulosDoEixo(dias, largura).map(({ i, texto }) => (
            <text key={i} x={x(i)} y={altura - 8} textAnchor="middle" className="fill-tinta-2 text-[10px]">
              {texto}
            </text>
          ))}

          <g clipPath={`url(#${idRecorte})`}>
            {series.map((s, k) => (
              <g key={s.chave}>
                {k === 0 && n > 1 && <path d={area(s.chave)} className="fill-navy/10" />}
                {n > 1 ? (
                  <path
                    d={caminho(s.chave)}
                    fill="none"
                    className={s.cor === 'sucesso' ? 'stroke-sucesso' : 'stroke-navy'}
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    strokeDasharray={k === 1 ? '5 4' : undefined}
                  />
                ) : (
                  <circle cx={x(0)} cy={y(dias[0][s.chave])} r="3.5" className={s.cor === 'sucesso' ? 'fill-sucesso' : 'fill-navy'} />
                )}
              </g>
            ))}
          </g>

          {dia && (
            <g>
              <line x1={dicaX} x2={dicaX} y1={MARGEM.topo} y2={MARGEM.topo + internaH} className="stroke-borda-forte" strokeWidth="1" strokeDasharray="3 3" />
              {series.map((s) => (
                <circle
                  key={s.chave}
                  cx={dicaX}
                  cy={y(dia[s.chave])}
                  r="4"
                  className={`${s.cor === 'sucesso' ? 'stroke-sucesso' : 'stroke-navy'} fill-superficie`}
                  strokeWidth="2"
                />
              ))}
            </g>
          )}
        </svg>

        {dia && (
          <div
            aria-hidden="true"
            data-dica
            className="pointer-events-none absolute top-1 z-10 rounded-lg bg-navy px-3 py-2 text-xs text-white shadow-md"
            style={
              dicaParaEsquerda
                ? { right: `${largura - dicaX + 10}px` }
                : { left: `${dicaX + 10}px` }
            }
          >
            <p className="font-medium">{porExtenso(dia.dia)}</p>
            {series.map((s) => (
              <p key={s.chave}>
                {s.rotulo}: <strong>{dia[s.chave]}</strong>
              </p>
            ))}
          </div>
        )}

        <p className="sr-only" role="status" aria-live="polite">
          {anunciar}
        </p>
      </div>
    </div>
  );
}

/** No máximo seis datas no eixo, espaçadas por igual: mais que isso se sobrepõe no celular. */
function rotulosDoEixo(dias, largura) {
  const n = dias.length;
  const quantos = Math.min(n, largura < 480 ? 3 : 6);
  if (quantos <= 1) return n ? [{ i: 0, texto: ddmm(dias[0].dia) }] : [];
  return Array.from({ length: quantos }, (_, k) => {
    const i = Math.round((k / (quantos - 1)) * (n - 1));
    return { i, texto: ddmm(dias[i].dia) };
  });
}

export default GraficoDeLinhas;
