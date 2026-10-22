import { useEffect, useState } from 'react';
import api from '../api/client';
import Aviso from './ui/Aviso';
import { formatarTamanho } from '../dominio/prepararAnexo';

/**
 * Avisa a gestão quando o banco passa de 70% do espaço do plano.
 *
 * Os anexos moram no banco (a não ser que o Storage esteja ligado) e o plano gratuito
 * tem 500 MB para o sistema todo. Banco cheio não degrada devagar: a escrita para, e com
 * ela a abertura de chamados, inclusive os críticos. O aviso vem com folga para ligar o
 * Storage (docs/piloto.md, seção 2.1.2), que leva um dia, e não no dia em que acaba.
 *
 * Sem nada a dizer (espaço folgado, ou a consulta falhou), não ocupa espaço.
 */
function AvisoDeEspaco() {
  const [uso, setUso] = useState(null);

  useEffect(() => {
    let ativo = true;
    api
      .get('/operacao/armazenamento')
      .then((resposta) => {
        if (ativo && resposta?.data?.alerta) setUso(resposta.data);
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, []);

  if (!uso) return null;

  const noStorage = uso.modo === 'supabase';

  return (
    <Aviso tipo="atencao" titulo="O espaço do banco está acabando" className="mb-4">
      <p>
        O banco usa {formatarTamanho(uso.banco_bytes)} de {formatarTamanho(uso.limite_bytes)} (
        {uso.percentual.toLocaleString('pt-BR')}%).{' '}
        {uso.anexos_no_banco > 0 &&
          `${uso.anexos_no_banco} anexos guardados no banco ocupam ${formatarTamanho(uso.anexos_no_banco_bytes)}.`}
      </p>
      <p className="mt-1 text-xs">
        {noStorage
          ? 'Os anexos novos já vão para o Storage; o que cresce agora é o resto do banco. Avalie um plano maior (docs/piloto.md, seção 2.1.2).'
          : 'Com o banco cheio, deixa-se de abrir chamado. Ligue o Storage para os anexos novos antes disso (docs/piloto.md, seção 2.1.2).'}
      </p>
    </Aviso>
  );
}

export default AvisoDeEspaco;
