import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import api, { CHAVE_USUARIO, EVENTO_SESSAO_EXPIRADA } from '../api/client';
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
   * ainda não abre nada: devolve `{ requer2fa, desafio }`, e a tela pede o
   * código para `confirmarCodigo`.
   */
  const login = useCallback(
    async (email, senha) => {
      const { data } = await api.post('/auth/login', { email, senha });
      if (data.requer_2fa) return { requer2fa: true, desafio: data.desafio };
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
    <AuthContext.Provider value={{ usuario, sessaoExpirada, saiu, login, confirmarCodigo, registrar, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const contexto = useContext(AuthContext);
  if (!contexto) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider.');
  }
  return contexto;
}
