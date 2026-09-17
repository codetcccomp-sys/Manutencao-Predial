import axios from 'axios';

// A API é sempre chamada pelo mesmo domínio do front: em produção um rewrite
// da Vercel (vercel.json) encaminha /api/* para o backend, e em dev o proxy do
// Vite faz o mesmo para localhost:3333. Assim não há CORS nem dependência de
// qual domínio o backend está publicado.
const api = axios.create({
  baseURL: '/api',
});

// Aviso de que o token deixou de valer. O interceptor não tem acesso ao estado
// do React, e limpar só o localStorage não bastava: o AuthContext continuava
// com o usuário em memória, a rota protegida seguia renderizando e a tela
// enchia de erro sem nunca voltar para o login.
export const EVENTO_SESSAO_EXPIRADA = 'smp:sessao-expirada';

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('smp_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // 401 no próprio login é credencial recusada, não sessão expirada — quem
    // está tentando entrar não tem sessão para perder, e tratar os dois casos
    // igual faria a tela de login anunciar que a sessão expirou a cada senha
    // errada.
    const ehTentativaDeLogin = error.config?.url?.includes('/auth/login');
    const tinhaSessao = Boolean(localStorage.getItem('smp_token'));

    if (error.response?.status === 401 && tinhaSessao && !ehTentativaDeLogin) {
      localStorage.removeItem('smp_token');
      localStorage.removeItem('smp_usuario');
      window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIRADA));
    }

    return Promise.reject(error);
  }
);

export default api;
