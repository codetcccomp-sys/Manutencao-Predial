import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import api, { CHAVE_USUARIO, EVENTO_2FA_OBRIGATORIO, EVENTO_SESSAO_EXPIRADA } from '../api/client';
import { limparDadosOffline } from '../pwa';

const AuthContext = createContext(null);

// Versões anteriores guardavam o token aqui. A sessão agora é um cookie
// HttpOnly; o que sobrou no aparelho de quem já usava o sistema sai na
// primeira carga, para não ficar um token esquecido ao alcance de scripts.
function limparTokenAntigo() {
  try {
    localStorage.removeItem('smp_token');
  } catch {
    // Armazenamento bloqueado: não há o que limpar.
  }
}

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(() => {
    limparTokenAntigo();
    const salvo = localStorage.getItem(CHAVE_USUARIO);
    return salvo ? JSON.parse(salvo) : null;
  });
  const [sessaoExpirada, setSessaoExpirada] = useState(false);
  // Saiu pelo botão Sair. A rota protegida usa isto para não guardar o endereço
  // de volta: o próximo a entrar no aparelho não deve cair na tela de quem saiu.
  const [saiu, setSaiu] = useState(false);

  // Sem isto, uma sessão vencida derrubava só o armazenamento: o usuário
  // seguia em memória, a rota protegida continuava renderizando e cada
  // requisição falhava com 401 até alguém recarregar a página na mão.
  useEffect(() => {
    function aoExpirar() {
      limparDadosOffline();
      setUsuario(null);
      setSaiu(false);
      setSessaoExpirada(true);
    }

    window.addEventListener(EVENTO_SESSAO_EXPIRADA, aoExpirar);
    return () => window.removeEventListener(EVENTO_SESSAO_EXPIRADA, aoExpirar);
  }, []);

  // A marca vem no login; a API também avisa quem já estava dentro quando a
  // exigência foi ligada. Com ela, a rota protegida leva a Minha conta.
  const marcarDoisFatores = useCallback((pendente) => {
    setUsuario((atual) => {
      if (!atual || Boolean(atual.dois_fatores_pendente) === pendente) return atual;
      const proximo = { ...atual, dois_fatores_pendente: pendente };
      localStorage.setItem(CHAVE_USUARIO, JSON.stringify(proximo));
      return proximo;
    });
  }, []);

  useEffect(() => {
    const aoExigir = () => marcarDoisFatores(true);
    window.addEventListener(EVENTO_2FA_OBRIGATORIO, aoExigir);
    return () => window.removeEventListener(EVENTO_2FA_OBRIGATORIO, aoExigir);
  }, [marcarDoisFatores]);

  const concluirDoisFatores = useCallback(() => marcarDoisFatores(false), [marcarDoisFatores]);

  const iniciarSessao = useCallback((dados) => {
    limparDadosOffline();
    localStorage.setItem(CHAVE_USUARIO, JSON.stringify(dados.usuario));
    setUsuario(dados.usuario);
    setSessaoExpirada(false);
    setSaiu(false);
    return dados.usuario;
  }, []);

  /**
   * Primeira etapa. Com a verificação em duas etapas ligada, a senha certa
   * ainda não abre nada: devolve `{ requer2fa, desafio, email }`, e a tela pede
   * o código para `confirmarCodigo`. O e-mail é o da conta que acabou de passar
   * pela primeira etapa, para a tela dizer em qual conta se está digitando.
   */
  const login = useCallback(
    async (email, senha) => {
      const { data } = await api.post('/auth/login', { email, senha });
      if (data.requer_2fa) return { requer2fa: true, desafio: data.desafio, email: data.email };
      return iniciarSessao(data);
    },
    [iniciarSessao]
  );

  const confirmarCodigo = useCallback(
    async (desafio, codigo) => {
      const { data } = await api.post('/auth/login/2fa', { desafio, codigo });
      return iniciarSessao(data);
    },
    [iniciarSessao]
  );

  // A credencial do botão do Google faz o papel de e-mail e senha: a resposta
  // tem as mesmas formas do login, mais a conta nova que espera a aprovação.
  const entrarComGoogle = useCallback(
    async (credencial) => {
      const { data } = await api.post('/auth/google', { credencial });
      if (data.aguardando_aprovacao) return { aguardandoAprovacao: true };
      if (data.requer_2fa) return { requer2fa: true, desafio: data.desafio, email: data.email };
      return iniciarSessao(data);
    },
    [iniciarSessao]
  );

  // Devolve a resposta: com a aprovação ligada (RF01), o cadastro nasce
  // esperando a gestão, e a tela precisa dizer isso em vez de mandar ao login.
  const registrar = useCallback(async (nome, email, senha) => {
    const { data } = await api.post('/auth/registrar', { nome, email, senha });
    return data;
  }, []);

  const logout = useCallback(() => {
    limparDadosOffline();
    // O cookie é HttpOnly: só o servidor o apaga. Sem rede, a tela sai do
    // mesmo jeito — e o cookie vence sozinho no prazo da sessão.
    api.post('/auth/sair').catch(() => {});
    localStorage.removeItem(CHAVE_USUARIO);
    setSaiu(true);
    setUsuario(null);
    // Sair por vontade própria não é sessão expirada: o aviso na tela de login
    // só faz sentido para quem foi desconectado sem pedir.
    setSessaoExpirada(false);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        usuario,
        sessaoExpirada,
        saiu,
        login,
        entrarComGoogle,
        confirmarCodigo,
        registrar,
        logout,
        concluirDoisFatores,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Quem está logado, se houver, SEM exigir o provedor: para as páginas públicas
 * (privacidade, termos, cookies, suporte), que mudam o caminho de volta conforme
 * haja sessão e também são renderizadas fora do `AuthProvider` nos testes.
 */
export function useUsuarioSeHouver() {
  return useContext(AuthContext)?.usuario ?? null;
}

export function useAuth() {
  const contexto = useContext(AuthContext);
  if (!contexto) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider.');
  }
  return contexto;
}
