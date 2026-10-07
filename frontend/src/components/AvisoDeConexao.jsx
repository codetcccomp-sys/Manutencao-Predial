import { useEffect, useState } from 'react';
import { EVENTO_DADOS_GUARDADOS } from '../api/eventos';
import Icone from './ui/Icone';

/**
 * Faixa que diz quando a tela não é o estado de agora.
 *
 * Sem conexão, o service worker devolve a última fila e o último chamado
 * guardados. Mostrar isso sem aviso seria pior que não mostrar: o técnico
 * leria "atribuído a você" num chamado que a gestão reatribuiu há uma hora.
 */
function AvisoDeConexao() {
  const [semRede, setSemRede] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  const [guardados, setGuardados] = useState(false);

  useEffect(() => {
    const aoCair = () => setSemRede(true);
    const aoVoltar = () => setSemRede(false);
    const aoReceber = (e) => setGuardados(Boolean(e.detail));
    window.addEventListener('offline', aoCair);
    window.addEventListener('online', aoVoltar);
    window.addEventListener(EVENTO_DADOS_GUARDADOS, aoReceber);
    return () => {
      window.removeEventListener('offline', aoCair);
      window.removeEventListener('online', aoVoltar);
      window.removeEventListener(EVENTO_DADOS_GUARDADOS, aoReceber);
    };
  }, []);

  if (!semRede && !guardados) return null;

  return (
    <div role="status" className="bg-atencao-tenue text-atencao print:hidden">
      <p className="max-w-7xl mx-auto px-4 py-2 text-sm flex items-start gap-2">
        <Icone nome="alerta" classe="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          <strong>Sem conexão.</strong> O que está na tela é a última versão salva neste aparelho, não
          o estado de agora. Ações (iniciar, concluir, comentar) não serão registradas até a conexão
          voltar.
        </span>
      </p>
    </div>
  );
}

export default AvisoDeConexao;
