import axios from 'axios';
import { EVENTO_DADOS_GUARDADOS } from './eventos';

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


export const MENSAGEM_SEM_CONEXAO =
  'Sem conexão com o servidor: nada foi registrado. Tente de novo quando a conexão voltar.';

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('smp_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    window.dispatchEvent(
      new CustomEvent(EVENTO_DADOS_GUARDADOS, {
        detail: response.headers?.['x-servido-do-cache'] === '1',
      })
    );
    return response;
  },
  (error) => {
    // Sem resposta nenhuma é rede, não servidor. Cada tela mostra
    // `erro.response.data.erro.mensagem` quando existe, e um genérico ("não
    // foi possível concluir") quando não — e o genérico, sem conexão, deixava
    // a pessoa sem saber se a ação tinha ido ou não. Status 0 de propósito:
    // não é 401, e não desloga ninguém.
    if (!error.response && error.code !== 'ERR_CANCELED') {
      error.response = {
        status: 0,
        data: { erro: { mensagem: MENSAGEM_SEM_CONEXAO, codigo: 'SEM_CONEXAO' } },
      };
      return Promise.reject(error);
    }

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

/**
 * Baixa um arquivo servido pela API.
 *
 * Não dá para usar um link direto: a rota exige o cabeçalho de autorização,
 * que uma navegação do navegador não envia. Então busca-se o blob e entrega-se
 * ao navegador. O nome vem do Content-Disposition — é o servidor que decide
 * como o arquivo se chama, e repetir a regra aqui criaria duas verdades.
 *
 * Quando o servidor recusa, a resposta é JSON mesmo tendo sido pedida como
 * blob; sem desembrulhar, o erro chegaria à tela como "[object Blob]".
 */
export async function baixarArquivo(caminho, params) {
  try {
    const resposta = await api.get(caminho, { params, responseType: 'blob' });
    const disposicao = resposta.headers['content-disposition'] || '';
    const nome = /filename="([^"]+)"/.exec(disposicao)?.[1] || 'download';

    const url = URL.createObjectURL(resposta.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = nome;
    link.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    const corpo = err.response?.data;
    if (corpo instanceof Blob && corpo.type.includes('json')) {
      const { erro } = JSON.parse(await corpo.text());
      throw new Error(erro?.mensagem || 'Não foi possível gerar o arquivo.');
    }
    throw new Error(err.response?.data?.erro?.mensagem || 'Não foi possível gerar o arquivo.');
  }
}

export default api;
