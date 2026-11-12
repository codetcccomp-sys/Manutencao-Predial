import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import Aviso from '../components/ui/Aviso';
import Botao from '../components/ui/Botao';
import CabecalhoDePagina from '../components/ui/CabecalhoDePagina';
import CodigoQR from '../components/ui/CodigoQR';
import { Selecao } from '../components/ui/Campo';
import { enderecoDeAbertura, rotuloLocal } from '../dominio/preventiva';

/**
 * Etiquetas com QR Code para imprimir e colar.
 *
 * No equipamento, o QR abre o chamado já com o equipamento escolhido; na porta
 * da sala, com o local. É o atalho que encurta o caminho de quem percebe o
 * problema: aponta a câmera, escreve o que viu, envia. Sem procurar o prédio,
 * o bloco e o pavimento numa lista.
 *
 * A tela é a própria folha de impressão: o cabeçalho do sistema e os
 * controles somem no papel (`print:hidden`), e cada etiqueta não se parte
 * entre duas páginas.
 */
function Etiquetas() {
  const { usuario } = useAuth();
  const podeGerenciar = ['administrador', 'gestor'].includes(usuario.perfil);
  const [parametros, setParametros] = useSearchParams();

  const tipo = parametros.get('tipo') === 'locais' ? 'locais' : 'equipamentos';
  const somenteEquipamento = parametros.get('equipamento');
  const localFiltro = parametros.get('local_id') ?? '';

  const [locais, setLocais] = useState([]);
  const [equipamentos, setEquipamentos] = useState([]);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!podeGerenciar) return;
    api
      .get('/locais')
      .then(({ data }) => setLocais(data.locais))
      .catch(() => setErro('Não foi possível carregar os locais.'));
  }, [podeGerenciar]);

  useEffect(() => {
    if (!podeGerenciar || tipo !== 'equipamentos') return;
    api
      .get('/equipamentos', { params: localFiltro ? { local_id: localFiltro } : {} })
      .then(({ data }) => setEquipamentos(data.equipamentos))
      .catch(() => setErro('Não foi possível carregar os equipamentos.'));
  }, [podeGerenciar, tipo, localFiltro]);

  if (!podeGerenciar) return <Navigate to="/" replace />;

  function mudar(campo, valor) {
    const novo = new URLSearchParams(parametros);
    if (valor) novo.set(campo, valor);
    else novo.delete(campo);
    novo.delete('equipamento');
    setParametros(novo, { replace: true });
  }

  const etiquetas =
    tipo === 'locais'
      ? locais
          .filter((l) => !localFiltro || String(l.id) === localFiltro)
          .map((l) => ({
            chave: `l${l.id}`,
            titulo: rotuloLocal(l),
            linha: 'Abrir chamado neste local',
            endereco: enderecoDeAbertura({ local: l }),
          }))
      : equipamentos
          .filter((e) => !somenteEquipamento || String(e.id) === somenteEquipamento)
          .map((e) => ({
            chave: `e${e.id}`,
            codigo: e.codigo,
            titulo: e.nome,
            linha: e.local_rotulo,
            endereco: enderecoDeAbertura({ equipamento: e }),
          }));

  return (
    <div className="grid gap-6">
      <div className="print:hidden grid gap-4">
        <CabecalhoDePagina
          titulo="Etiquetas com QR Code"
          acao={
            <Botao variante="primaria" onClick={() => window.print()} disabled={etiquetas.length === 0}>
              Imprimir
            </Botao>
          }
          className="mb-0"
        />
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
          <Selecao rotulo="Etiquetas de" value={tipo} onChange={(e) => mudar('tipo', e.target.value)}>
            <option value="equipamentos">Equipamentos</option>
            <option value="locais">Locais (porta da sala)</option>
          </Selecao>
          <Selecao
            rotulo="Local"
            opcional
            value={localFiltro}
            onChange={(e) => mudar('local_id', e.target.value)}
          >
            <option value="">Todos</option>
            {locais.map((l) => (
              <option key={l.id} value={l.id}>
                {rotuloLocal(l)}
              </option>
            ))}
          </Selecao>
        </div>
        <p className="text-xs text-tinta-2">
          {etiquetas.length} {etiquetas.length === 1 ? 'etiqueta' : 'etiquetas'}.
        </p>
      </div>

      <ul className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 print:gap-2">
        {etiquetas.map((e) => (
          <li
            key={e.chave}
            className="flex items-center gap-3 rounded border border-dashed border-borda-forte bg-white p-3 text-black break-inside-avoid"
          >
            <CodigoQR
              texto={e.endereco}
              tamanho={112}
              rotulo={`QR Code para abrir chamado: ${e.codigo ?? e.titulo}`}
              className="shrink-0"
            />
            <div className="min-w-0 text-sm">
              {e.codigo && <p className="font-mono text-base font-bold break-all">{e.codigo}</p>}
              <p className="font-medium break-words">{e.titulo}</p>
              <p className="text-xs break-words">{e.linha}</p>
              <p className="mt-1 text-[10px] uppercase tracking-wide">Conserva Predial · aponte a câmera</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default Etiquetas;
