import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import api, { EVENTO_SESSAO_EXPIRADA } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(() => {
    const salvo = localStorage.getItem('smp_usuario');
    return salvo ? JSON.parse(salvo) : null;
  });
  const [sessaoExpirada, setSessaoExpirada] = useState(false);

  // Sem isto, um token vencido derrubava só o localStorage: o usuário seguia
  // em memória, a rota protegida continuava renderizando e cada requisição
  // falhava com 401 até alguém recarregar a página na mão.
  useEffect(() => {
    function aoExpirar() {
      setUsuario(null);
      setSessaoExpirada(true);
    }

    window.addEventListener(EVENTO_SESSAO_EXPIRADA, aoExpirar);
    return () => window.removeEventListener(EVENTO_SESSAO_EXPIRADA, aoExpirar);
  }, []);

  const login = useCallback(async (email, senha) => {
    const { data } = await api.post('/auth/login', { email, senha });
    localStorage.setItem('smp_token', data.token);
    localStorage.setItem('smp_usuario', JSON.stringify(data.usuario));
    setUsuario(data.usuario);
    setSessaoExpirada(false);
    return data.usuario;
  }, []);

  const registrar = useCallback(async (nome, email, senha) => {
    await api.post('/auth/registrar', { nome, email, senha });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('smp_token');
    localStorage.removeItem('smp_usuario');
    setUsuario(null);
    // Sair por vontade própria não é sessão expirada: o aviso na tela de login
    // só faz sentido para quem foi desconectado sem pedir.
    setSessaoExpirada(false);
  }, []);

  return (
    <AuthContext.Provider value={{ usuario, sessaoExpirada, login, registrar, logout }}>
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
