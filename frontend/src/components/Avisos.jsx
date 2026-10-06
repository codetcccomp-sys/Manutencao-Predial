import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

const TIPO_ROTULO = {
  atribuicao: 'Designação',
  mudanca_estado: 'Mudança de estado',
  conclusao: 'Conclusão',
  atraso: 'Atraso',
  comentario: 'Comentário',
  reabertura: 'Reabertura',
};

// Atraso e reabertura são os dois avisos que pedem ação; os demais são
// informativos. A cor não carrega a informação sozinha — o rótulo de tipo
// está escrito ao lado, porque a RNF02 pede não depender só de cor.
const TIPO_COR = {
  atraso: 'bg-red-100 text-red-700',
  reabertura: 'bg-amber/20 text-amber',
};

const INTERVALO_MS = 60_000;

function quandoFoi(data) {
  const minutos = Math.floor((Date.now() - new Date(data).getTime()) / 60_000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? 'ontem' : `há ${dias} dias`;
}

const LARGURA_PAINEL = 320;
const MARGEM_TELA = 16;

function Avisos() {
  const navegar = useNavigate();
  const [avisos, setAvisos] = useState([]);
  const [aberto, setAberto] = useState(false);
  const [posicao, setPosicao] = useState(null);
  const caixa = useRef(null);
  const botao = useRef(null);

  const carregar = useCallback(() => {
    api
      .get('/notificacoes')
      .then(({ data }) => setAvisos(data.notificacoes))
      // Silencioso de propósito: aviso é acessório, e uma faixa de erro
      // vermelha no cabeçalho a cada falha de rede atrapalharia o trabalho
      // em vez de ajudar.
      .catch(() => {});
  }, []);

  useEffect(() => {
    carregar();
    // O aviso de atraso nasce de uma varredura agendada, não de uma ação de
    // quem está na tela: sem reconsultar, ele só apareceria no próximo F5.
    const id = setInterval(carregar, INTERVALO_MS);
    return () => clearInterval(id);
  }, [carregar]);

  // Fechar ao clicar fora é o que se espera de um painel suspenso; sem isso
  // ele fica preso na tela até clicarem no sino de novo.
  useEffect(() => {
    if (!aberto) return;
    function aoClicar(evento) {
      if (caixa.current && !caixa.current.contains(evento.target)) setAberto(false);
    }
    // Redimensionar move o sino e deixaria o painel deslocado, já que a
    // posição é calculada na abertura.
    function aoRedimensionar() {
      setAberto(false);
    }
    document.addEventListener('mousedown', aoClicar);
    window.addEventListener('resize', aoRedimensionar);
    return () => {
      document.removeEventListener('mousedown', aoClicar);
      window.removeEventListener('resize', aoRedimensionar);
    };
  }, [aberto]);

  /**
   * Abre o painel preso à viewport, e não ao sino.
   *
   * Alinhado só pela direita do sino, o painel saía pela esquerda da tela no
   * celular: o sino fica a poucos pixels da borda direita, e 320px para a
   * esquerda caem fora. O texto ficava cortado sem que nada acusasse —
   * transbordo à esquerda não gera barra de rolagem, então nem o scrollWidth
   * denuncia. Calcular a posição na abertura e prendê-la entre as margens é o
   * que garante que o painel inteiro fique visível em qualquer largura.
   */
  function alternar() {
    if (!aberto && botao.current) {
      const r = botao.current.getBoundingClientRect();
      const largura = Math.min(LARGURA_PAINEL, window.innerWidth - MARGEM_TELA * 2);
      const limiteDireito = window.innerWidth - largura - MARGEM_TELA;
      setPosicao({
        top: r.bottom + 8,
        left: Math.max(MARGEM_TELA, Math.min(r.right - largura, limiteDireito)),
        width: largura,
      });
    }
    setAberto((v) => !v);
  }

  const naoLidas = avisos.filter((a) => !a.lida).length;

  async function abrirChamado(aviso) {
    setAberto(false);
    if (!aviso.lida) {
      try {
        await api.patch(`/notificacoes/${aviso.id}/lida`);
        setAvisos((atuais) =>
          atuais.map((a) => (a.id === aviso.id ? { ...a, lida: true } : a))
        );
      } catch {
        // Marcar como lida é conveniência; não pode impedir a navegação.
      }
    }
    navegar(`/chamados/${aviso.chamado_id}`);
  }

  async function marcarTodas() {
    const pendentes = avisos.filter((a) => !a.lida);
    setAvisos((atuais) => atuais.map((a) => ({ ...a, lida: true })));
    await Promise.allSettled(pendentes.map((a) => api.patch(`/notificacoes/${a.id}/lida`)));
    carregar();
  }

  return (
    <div className="relative" ref={caixa}>
      <button
        ref={botao}
        onClick={alternar}
        className="relative rounded px-2 py-1 hover:bg-navy-2"
        aria-label={naoLidas > 0 ? `Avisos: ${naoLidas} não lidos` : 'Avisos'}
        aria-expanded={aberto}
      >
        <span aria-hidden="true">🔔</span>
        {/* O contador fica sobre o navy do cabeçalho, então usa o âmbar claro:
            o âmbar de superfície clara é escuro, e texto navy sobre ele seria
            escuro sobre escuro. Assim são 8,14:1. */}
        {naoLidas > 0 && (
          <span className="absolute -top-1 -right-1 bg-amber-claro text-navy-2 text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
            {naoLidas > 9 ? '9+' : naoLidas}
          </span>
        )}
      </button>

      {aberto && posicao && (
        <div
          style={posicao}
          className="fixed bg-white text-gray-800 rounded-lg shadow-lg z-20 overflow-hidden animate-modal-in origin-top-right"
        >
          <div className="flex items-center justify-between px-4 py-2 border-b">
            <span className="font-medium text-navy text-sm">Avisos</span>
            {naoLidas > 0 && (
              <button onClick={marcarTodas} className="text-xs text-navy hover:underline">
                Marcar todos como lidos
              </button>
            )}
          </div>

          {avisos.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500 text-center">Nenhum aviso por aqui.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {avisos.map((aviso) => (
                <li key={aviso.id} className="border-b last:border-0">
                  <button
                    onClick={() => abrirChamado(aviso)}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${
                      aviso.lida ? '' : 'bg-blue-50/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span
                        className={`text-[10px] font-medium px-2 py-0.5 rounded ${
                          TIPO_COR[aviso.tipo] || 'bg-gray-200 text-gray-700'
                        }`}
                      >
                        {TIPO_ROTULO[aviso.tipo] ?? aviso.tipo}
                      </span>
                      <span className="text-[10px] text-gray-500 shrink-0">
                        {quandoFoi(aviso.data)}
                      </span>
                    </div>
                    <p className={`text-xs ${aviso.lida ? 'text-gray-600' : 'text-gray-800'}`}>
                      {aviso.mensagem}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default Avisos;
