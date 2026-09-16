import axios from 'axios';

// A API é sempre chamada pelo mesmo domínio do front: em produção um rewrite
// da Vercel (vercel.json) encaminha /api/* para o backend, e em dev o proxy do
// Vite faz o mesmo para localhost:3333. Assim não há CORS nem dependência de
// qual domínio o backend está publicado.
const api = axios.create({
  baseURL: '/api',
});

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
    if (error.response?.status === 401) {
      localStorage.removeItem('smp_token');
      localStorage.removeItem('smp_usuario');
    }
    return Promise.reject(error);
  }
);

export default api;
