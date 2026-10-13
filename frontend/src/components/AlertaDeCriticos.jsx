import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import api from '../api/client';
import Icone from './ui/Icone';

/**
 * Faixa de alerta da gestão: chamados críticos que ninguém pegou ainda.
 *
 * Fica no Layout, e não só no painel, porque quem distribui nem sempre está
 * nele: com Relatórios aberto, o chamado crítico parado continuaria invisível.
 * Aparece só quando há algum, e some sozinha quando a triagem tira o chamado de
 * "aberto".
 *
 * A contagem é uma consulta leve (`limite=1`, lendo só o total da paginação, o
 * mesmo truque dos cartões do painel). Roda ao entrar, a cada navegação e a
 * cada minuto: o relógio dos 15 minutos corre sem ninguém clicar, então esperar
 * a pessoa recarregar a página seria deixar o alerta para depois do prazo que
 * ele existe para cobrar. A navegação conta porque quem acabou de fazer a
 * triagem volta ao painel esperando a faixa já sem aquele chamado.
 */
const INTERVALO = 60_000;

function AlertaDeCriticos() {
  const { pathname } = useLocation();
  const [alerta, setAlerta] = useState({ total: 0, minutos: null });

  useEffect(() => {
    let vivo = true;

    async function consultar() {
      // Aba escondida não precisa do número: ele é refeito quando ela volta.
      if (document.hidden) return;
      try {
        const { data, headers } = await api.get('/chamados', {
          params: { sem_atendimento: 'true', limite: 1 },
        });
        // Resposta guardada pelo service worker é a de antes da queda. Dizer
        // "agora" com ela seria falso, e o aviso de conexão já cobre o resto.
        if (!vivo || headers?.['x-servido-do-cache']) return;
        setAlerta({ total: data.paginacao.total, minutos: data.atendimento_critico_minutos });
      } catch {
        // Falha de rede ou de servidor: fica o último número conhecido.
      }
    }

    consultar();
    const id = setInterval(consultar, INTERVALO);
    document.addEventListener('visibilitychange', consultar);
    return () => {
      vivo = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', consultar);
    };
  }, [pathname]);

  if (!alerta.total) return null;

  const { total, minutos } = alerta;
  return (
    <div role="alert" className="bg-erro-tenue text-erro print:hidden">
      <p className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
        <Icone nome="alerta" classe="h-4 w-4 shrink-0" />
        <span>
          <strong>
            {total} {total === 1 ? 'chamado crítico sem atendimento' : 'chamados críticos sem atendimento'}
          </strong>
          {minutos ? ` há mais de ${minutos} minutos.` : '.'}
        </span>
        <Link
          to="/?recorte=criticos"
          className="alvo-toque inline-block py-1 font-medium underline underline-offset-2"
        >
          Ver {total === 1 ? 'o chamado' : 'os chamados'}
        </Link>
      </p>
    </div>
  );
}

export default AlertaDeCriticos;
