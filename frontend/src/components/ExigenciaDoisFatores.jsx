import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import api from '../api/client';
import Aviso from './ui/Aviso';
import Cartao from './ui/Cartao';

/**
 * A chave que exige a verificação em duas etapas de gestores e
 * administradores (tela de Usuários, só a administração).
 *
 * Mostra quem ainda não ligou antes de alguém apertar: ligada a exigência,
 * essas contas entram, mas só alcançam Minha conta até ligar. O servidor
 * recusa ligar para quem não tem a própria verificação.
 *
 * A caixa liga na hora, sem confirmação, e o efeito é sobre outras pessoas.
 * Por isso o rótulo diz quantas contas ela restringe agora, e a lista de quem
 * falta traz o e-mail (dois "Ana" não se distinguem pelo nome) e para em cinco:
 * com muitas contas de gestão o cartão cresceria sem fim, e uma lista longa não
 * ajuda a decidir.
 */
const LIMITE_DA_LISTA = 5;

const plural = (n, singular, pluralizado) => (n === 1 ? singular : pluralizado);

function ExigenciaDoisFatores({ usuarios }) {
  const [exige, setExige] = useState(null);
  const [erro, setErro] = useState('');
  // A recusa por falta da própria verificação tem saída numa tela só: Minha conta.
  const [erroPedeMinhaConta, setErroPedeMinhaConta] = useState(false);
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    api
      .get('/configuracoes')
      .then(({ data }) => setExige(Boolean(data.configuracoes?.exigir_2fa_gestao)))
      .catch(() => setErro('Não foi possível carregar a configuração.'));
  }, []);

  const semVerificacao = usuarios.filter(
    (u) => ['gestor', 'administrador'].includes(u.perfil) && u.ativo && !u.anonimizado_em && !u.dois_fatores
  );

  async function mudar(valor) {
    setErro('');
    setErroPedeMinhaConta(false);
    setAviso('');
    try {
      const { data } = await api.patch('/configuracoes', { exigir_2fa_gestao: valor });
      setExige(data.configuracoes.exigir_2fa_gestao);
      setAviso(
        valor
          ? 'Exigência ligada. Quem ainda não ligou a verificação vai direto para Minha conta.'
          : 'Exigência desligada. A verificação volta a ser opcional.'
      );
    } catch (err) {
      const corpo = err.response?.data?.erro;
      setErro(corpo?.mensagem || 'Não foi possível mudar a configuração.');
      setErroPedeMinhaConta(corpo?.codigo === 'SEM_2FA_PROPRIO');
    }
  }

  const faltam = semVerificacao.length;
  const visiveis = semVerificacao.slice(0, LIMITE_DA_LISTA);
  const restantes = faltam - visiveis.length;

  let consequencia = 'Quem ainda não ligou continua entrando, mas só alcança Minha conta até ligar.';
  if (faltam > 0 && exige === false) {
    consequencia = `Ao ligar, ${faltam} ${plural(faltam, 'conta fica restrita', 'contas ficam restritas')} a Minha conta até ${plural(faltam, 'ela', 'elas')} ligar${plural(faltam, '', 'em')} a verificação. ${plural(faltam, 'Ela continua entrando.', 'Elas continuam entrando.')}`;
  } else if (faltam > 0 && exige === true) {
    consequencia = `${faltam} ${plural(faltam, 'conta está restrita', 'contas estão restritas')} a Minha conta até ${plural(faltam, 'ela', 'elas')} ligar${plural(faltam, '', 'em')} a verificação.`;
  }

  return (
    <Cartao titulo="Verificação em duas etapas da gestão">
      <div className="grid gap-3 text-sm">
        {erro && (
          <Aviso tipo="erro">
            {erro}
            {erroPedeMinhaConta && (
              <>
                {' '}
                <Link to="/conta" className="alvo-toque inline-block py-1 font-medium underline">
                  Abrir Minha conta
                </Link>
              </>
            )}
          </Aviso>
        )}
        {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}

        {exige !== null && (
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={exige} onChange={(e) => mudar(e.target.checked)} />
            <span>
              Exigir a verificação em duas etapas de gestores e administradores
              <span className="block text-xs text-tinta-2">{consequencia}</span>
            </span>
          </label>
        )}

        {faltam === 0 ? (
          <p className="text-tinta-2">Toda a gestão ativa já tem a verificação ligada.</p>
        ) : (
          <div className="text-tinta-2">
            <p>{faltam === 1 ? 'Ainda sem a verificação:' : `${faltam} contas ainda sem a verificação:`}</p>
            <ul className="mt-1 grid list-disc gap-0.5 pl-5">
              {visiveis.map((u) => (
                <li key={u.id}>
                  {u.nome}
                  {u.email && <span className="break-all"> ({u.email})</span>}
                </li>
              ))}
            </ul>
            {restantes > 0 && <p className="mt-1">e mais {restantes}.</p>}
          </div>
        )}
      </div>
    </Cartao>
  );
}

export default ExigenciaDoisFatores;
