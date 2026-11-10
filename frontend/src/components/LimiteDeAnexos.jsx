import { useEffect, useId, useState } from 'react';
import api from '../api/client';
import Aviso from './ui/Aviso';
import Botao from './ui/Botao';
import Cartao from './ui/Cartao';

/**
 * RF03: quantos anexos cabem num chamado, definido pela administração.
 *
 * O Termo pede anexos "dentro de limites definidos pela administração"; o número
 * era uma constante do código, que só mudava com um deploy. A faixa (1 a 20) vem
 * do servidor de propósito pela recusa: o teto é a folga do banco de dados, e não
 * uma escolha desta tela.
 *
 * Tem botão de salvar, e não grava a cada tecla: quem digita "15" passaria por
 * "1", e por um instante nenhum chamado aceitaria a segunda foto.
 */
const MINIMO = 1;
const MAXIMO = 20;

function LimiteDeAnexos() {
  const id = useId();
  const [gravado, setGravado] = useState(null);
  const [valor, setValor] = useState('');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api
      .get('/configuracoes')
      .then(({ data }) => {
        const limite = data.configuracoes?.anexos_por_chamado;
        if (limite == null) return;
        setGravado(limite);
        setValor(String(limite));
      })
      .catch(() => setErro('Não foi possível carregar o limite de anexos.'));
  }, []);

  async function salvar(e) {
    e.preventDefault();
    setErro('');
    setAviso('');
    const numero = Number(valor);
    // Campo vazio vira 0 em `Number('')`, e cai na faixa como qualquer outro valor.
    if (!Number.isInteger(numero) || numero < MINIMO || numero > MAXIMO) {
      setErro(`Informe um número inteiro de ${MINIMO} a ${MAXIMO}.`);
      return;
    }
    if (numero === gravado) {
      setAviso(`O limite já é de ${numero} ${numero === 1 ? 'anexo' : 'anexos'} por chamado.`);
      return;
    }
    setSalvando(true);
    try {
      const { data } = await api.patch('/configuracoes', { anexos_por_chamado: numero });
      const novo = data.configuracoes.anexos_por_chamado;
      setGravado(novo);
      setValor(String(novo));
      setAviso(`Limite alterado: cada chamado aceita até ${novo} ${novo === 1 ? 'anexo' : 'anexos'}.`);
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível alterar o limite de anexos.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Cartao
      titulo="Anexos por chamado"
      descricao="Quantas fotos e documentos cada chamado aceita. O tamanho de cada arquivo (4 MB) não muda."
    >
      <form onSubmit={salvar} className="grid gap-3 text-sm" noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}

        {gravado !== null && (
          <>
            <div className="grid gap-1">
              <label htmlFor={id} className="font-medium text-tinta">
                Limite de anexos por chamado
              </label>
              <p id={`${id}-ajuda`} className="text-xs text-tinta-2">
                De {MINIMO} a {MAXIMO}. Vale para os próximos envios: um chamado que já tem mais anexos que o
                novo limite fica como está e só deixa de aceitar outros.
              </p>
              <input
                id={id}
                type="number"
                inputMode="numeric"
                min={MINIMO}
                max={MAXIMO}
                step={1}
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                aria-describedby={`${id}-ajuda`}
                className="alvo-toque w-24 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm text-tinta"
              />
            </div>
            <div>
              <Botao type="submit" variante="primaria" carregando={salvando}>
                Salvar limite
              </Botao>
            </div>
          </>
        )}
      </form>
    </Cartao>
  );
}

export default LimiteDeAnexos;
