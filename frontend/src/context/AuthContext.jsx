import { createContext, useContext, useState, useCallback } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(() => {
    const salvo = localStorage.getItem('smp_usuario');
    return salvo ? JSON.parse(salvo) : null;
  });

  const login = useCallback(async (email, senha) => {
    const { data } = await api.post('/auth/login', { email, senha });
    localStorage.setItem('smp_token', data.token);
    localStorage.setItem('smp_usuario', JSON.stringify(data.usuario));
    setUsuario(data.usuario);
    return data.usuario;
  }, []);

  const registrar = useCallback(async (nome, email, senha) => {
    await api.post('/auth/registrar', { nome, email, senha });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('smp_token');
    localStorage.removeItem('smp_usuario');
    setUsuario(null);
  }, []);

  return (
    <AuthContext.Provider value={{ usuario, login, registrar, logout }}>
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
