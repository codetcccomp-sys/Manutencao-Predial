import { useEffect, useState } from 'react';
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
 */
function ExigenciaDoisFatores({ usuarios }) {
  const [exige, setExige] = useState(null);
  const [erro, setErro] = useState('');
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
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível mudar a configuração.');
    }
  }

  return (
    <Cartao
      titulo="Verificação em duas etapas da gestão"
      descricao="Gestores e administradores podem mais no sistema; com a senha vazada, a conta deles é a que mais expõe."
    >
      <div className="grid gap-3 text-sm">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}

        {exige !== null && (
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={exige} onChange={(e) => mudar(e.target.checked)} />
            <span>
              Exigir a verificação em duas etapas de gestores e administradores
              <span className="block text-xs text-tinta-2">
                Quem ainda não ligou continua entrando, mas só alcança Minha conta até ligar.
              </span>
            </span>
          </label>
        )}

        {semVerificacao.length === 0 ? (
          <p className="text-tinta-2">Toda a gestão ativa já tem a verificação ligada.</p>
        ) : (
          <p className="text-tinta-2">
            {semVerificacao.length === 1 ? 'Ainda sem a verificação: ' : `${semVerificacao.length} contas ainda sem a verificação: `}
            {semVerificacao.map((u) => u.nome).join(', ')}.
          </p>
        )}
      </div>
    </Cartao>
  );
}

export default ExigenciaDoisFatores;
