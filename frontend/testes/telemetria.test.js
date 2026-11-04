import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { criarTelemetria, eRuido } from '../src/monitoramento/telemetria';
import { calcularCLS, coletarVitais } from '../src/monitoramento/vitais';
import { padraoDaRota } from '../src/dominio/titulosDeRota';

/**
 * A telemetria do aplicativo (monitoramento/): contadores por dia, sem ninguém.
 *
 * O que estes testes seguram é o que a distingue de uma ferramenta de rastreamento: a tela vai pelo
 * MODELO da rota, nada fica guardado no aparelho, quem pede para não ser medido não é, e o erro
 * que chega à administração não leva endereço real.
 */

function nova(opcoes = {}) {
  const enviar = vi.fn();
  return { enviar, t: criarTelemetria({ enviar, ...opcoes }) };
}

describe('contagem e envio', () => {
  it('junta aberturas, ações e medidas, e manda tudo de uma vez, zerando em seguida', () => {
    const { enviar, t } = nova();
    t.registrarTela('/relatorios');
    t.registrarTela('/relatorios');
    t.registrarTela('/');
    t.registrarAcao('chamado_aberto');
    t.registrarMedida('LCP', '/', 1234.5678);

    t.descarregar();

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar).toHaveBeenCalledWith('/telemetria', {
      telas: { '/relatorios': 2, '/': 1 },
      acoes: { chamado_aberto: 1 },
      desempenho: [{ metrica: 'LCP', tela: '/', valor: 1234.568 }],
    });
    t.descarregar();
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('sem nada para dizer, não faz requisição', () => {
    const { enviar, t } = nova();

    t.descarregar();

    expect(enviar).not.toHaveBeenCalled();
  });

  it('respeita os tetos do servidor: 100 por nome e 12 medidas', () => {
    const { enviar, t } = nova();
    for (let i = 0; i < 150; i += 1) t.registrarTela('/');
    for (let i = 0; i < 20; i += 1) t.registrarMedida('FCP', '/', 100);

    t.descarregar();

    const corpo = enviar.mock.calls[0][1];
    expect(corpo.telas['/']).toBe(100);
    expect(corpo.desempenho).toHaveLength(12);
  });

  it('descarta medida que não é um número válido', () => {
    const { enviar, t } = nova();
    t.registrarMedida('LCP', '/', NaN);
    t.registrarMedida('LCP', '/', -1);
    t.registrarMedida('LCP', '/', Infinity);

    t.descarregar();

    expect(enviar).not.toHaveBeenCalled();
  });
});

describe('quem pede para não ser medido', () => {
  it('"Não rastrear" desliga o uso e o desempenho, mas não o erro da tela', () => {
    const { enviar, t } = nova({ semMedicao: () => true });

    t.registrarTela('/');
    t.registrarAcao('chamado_aberto');
    t.registrarMedida('LCP', '/', 900);
    t.descarregar();
    expect(enviar).not.toHaveBeenCalled();

    t.registrarErro({ mensagem: 'x is not a function', tela: '/' });
    expect(enviar).toHaveBeenCalledWith('/telemetria/erro', expect.objectContaining({ mensagem: 'x is not a function' }));
  });

  it('desligada por inteiro (testes, fora do navegador), não envia nada, nem erro', () => {
    const { enviar, t } = nova({ desligada: () => true });

    t.registrarTela('/');
    t.registrarErro({ mensagem: 'x', tela: '/' });
    t.descarregar();

    expect(enviar).not.toHaveBeenCalled();
  });
});

describe('erro da tela', () => {
  it('manda a mensagem, a tela e a pilha, e uma mensagem repetida só uma vez', () => {
    const { enviar, t } = nova();

    t.registrarErro({ mensagem: 'Cannot read properties of undefined', tela: '/chamados/:id', pilha: '    at Detalhe (a.js:1:1)' });
    t.registrarErro({ mensagem: 'Cannot read properties of undefined', tela: '/chamados/:id' });

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar).toHaveBeenCalledWith('/telemetria/erro', {
      mensagem: 'Cannot read properties of undefined',
      tela: '/chamados/:id',
      pilha: '    at Detalhe (a.js:1:1)',
    });
  });

  it('no máximo cinco por carga: um laço que falha não vira enxurrada', () => {
    const { enviar, t } = nova();

    for (let i = 0; i < 20; i += 1) t.registrarErro({ mensagem: `falha ${i}`, tela: '/' });

    expect(enviar).toHaveBeenCalledTimes(5);
  });

  it('mensagem vazia ou que não é texto é ignorada, e a pilha é cortada', () => {
    const { enviar, t } = nova();
    t.registrarErro({ mensagem: '', tela: '/' });
    t.registrarErro({ mensagem: undefined, tela: '/' });
    t.registrarErro({ mensagem: 'longa', tela: '/', pilha: 'a'.repeat(9000) });

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar.mock.calls[0][1].pilha).toHaveLength(4000);
  });

  it('reconhece o ruído do navegador, que não é defeito do aplicativo', () => {
    expect(eRuido('ResizeObserver loop completed with undelivered notifications.')).toBe(true);
    expect(eRuido('Script error.')).toBe(true);
    expect(eRuido("Cannot read properties of undefined (reading 'id')")).toBe(false);
  });
});

describe('a tela vai pelo modelo da rota, nunca pelo endereço', () => {
  it.each([
    ['/chamados/4821', '/chamados/:id'],
    ['/equipamentos/17', '/equipamentos/:id'],
    ['/chamados/novo', '/chamados/novo'],
    ['/relatorios', '/relatorios'],
    ['/', '/'],
  ])('%s vira %s', (caminho, modelo) => {
    expect(padraoDaRota(caminho)).toBe(modelo);
  });

  it('o que não existe vira "outra", sem repetir o endereço', () => {
    expect(padraoDaRota('/segredo/maria@exemplo.com/123')).toBe('outra');
    expect(padraoDaRota('/chamados/12/anexos/99')).toBe('outra');
  });
});

describe('desempenho', () => {
  it('o CLS é a pior janela de deslocamentos, e ignora o que veio de uma ação da pessoa', () => {
    const entradas = [
      { startTime: 100, value: 0.05 },
      { startTime: 600, value: 0.04 }, // mesma janela: soma 0,09
      { startTime: 9000, value: 0.02 }, // janela nova
      { startTime: 9500, value: 0.5, hadRecentInput: true }, // a pessoa clicou: não conta
    ];

    expect(calcularCLS(entradas)).toBeCloseTo(0.09, 5);
    expect(calcularCLS([])).toBe(0);
  });

  it('uma janela de deslocamentos não passa de 5 segundos', () => {
    const entradas = Array.from({ length: 12 }, (_, i) => ({ startTime: i * 900, value: 0.02 }));

    // 12 deslocamentos em ~10 s, 900 ms um do outro: duas janelas, e nenhuma soma os 12.
    expect(calcularCLS(entradas)).toBeLessThan(0.24);
    expect(calcularCLS(entradas)).toBeGreaterThan(0.09);
  });

  function observadorDe(entradasPorTipo) {
    return class Falso {
      constructor(chamada) {
        this.chamada = chamada;
      }

      observe({ type }) {
        const entradas = entradasPorTipo[type];
        if (entradas) this.chamada({ getEntries: () => entradas });
      }
    };
  }

  it('manda FCP na hora e LCP, CLS e INP quando a página é escondida, uma vez só', () => {
    const registrar = vi.fn();
    let esconder;
    coletarVitais({
      registrar,
      aoEsconder: (f) => {
        esconder = f;
      },
      Observador: observadorDe({
        paint: [{ name: 'first-contentful-paint', startTime: 800 }],
        'largest-contentful-paint': [{ startTime: 900 }, { startTime: 1500 }],
        'layout-shift': [{ startTime: 1000, value: 0.12 }],
        event: [
          { interactionId: 1, duration: 80 },
          { interactionId: 2, duration: 240 },
          { interactionId: 0, duration: 999 }, // sem interação: não conta
        ],
      }),
    });

    expect(registrar).toHaveBeenCalledWith('FCP', 800);
    expect(registrar).not.toHaveBeenCalledWith('LCP', expect.anything());

    esconder();
    esconder();

    expect(registrar).toHaveBeenCalledWith('LCP', 1500); // a última, não a primeira
    expect(registrar).toHaveBeenCalledWith('CLS', 0.12);
    expect(registrar).toHaveBeenCalledWith('INP', 240);
    expect(registrar).toHaveBeenCalledTimes(4);
  });

  it('num navegador sem a API, não mede nada e não quebra', () => {
    const registrar = vi.fn();

    expect(() => coletarVitais({ registrar, Observador: undefined, aoEsconder: () => {} })).not.toThrow();
    expect(registrar).not.toHaveBeenCalled();
  });

  it('um tipo de entrada que o navegador não conhece só tira aquela medida', () => {
    const registrar = vi.fn();
    class SemEvent {
      observe({ type }) {
        if (type === 'event') throw new TypeError('tipo não suportado');
      }
    }

    expect(() => coletarVitais({ registrar, Observador: SemEvent, aoEsconder: () => {} })).not.toThrow();
  });
});

describe('o aplicativo, em teste, não mede nem envia nada', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('as funções que as telas chamam são inofensivas sob o Vitest', async () => {
    const fetchEspiao = vi.fn();
    vi.stubGlobal('fetch', fetchEspiao);
    const { registrarAcao, registrarTela, registrarErro, telemetria, iniciarMonitoramento } = await import('../src/monitoramento');

    registrarTela('/');
    registrarAcao('chamado_aberto');
    registrarErro(new Error('x'));
    telemetria.descarregar();
    iniciarMonitoramento();

    expect(fetchEspiao).not.toHaveBeenCalled();
  });
});

describe('o que a telemetria não pode tocar', () => {
  const pasta = path.join(__dirname, '..', 'src', 'monitoramento');
  const codigo = fs
    .readdirSync(pasta)
    .map((nome) => fs.readFileSync(path.join(pasta, nome), 'utf8'))
    .join('\n')
    // O que está escrito nos comentários explica a regra e pode citar o que ela proíbe.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('não guarda nada no aparelho nem lê o que identifica a pessoa ou o endereço', () => {
    const proibido =
      /localStorage|sessionStorage|indexedDB|document\.cookie|userAgent|\.platform|screen\.|deviceMemory|hardwareConcurrency|location\.(href|pathname|search|hash)|referrer|getUserMedia|geolocation|canvas|fingerprint/i;

    expect(codigo.match(proibido)).toBeNull();
  });

  it('só fala com a própria origem', () => {
    const enderecos = [...codigo.matchAll(/fetch\(\s*[`'"]([^`'"]*)/g)].map((m) => m[1]);

    expect(enderecos.length).toBeGreaterThan(0);
    for (const endereco of enderecos) expect(endereco).toMatch(/^\/api/);
    expect(codigo).not.toMatch(/https?:\/\//);
  });
});
