import axios from 'axios';
import { EVENTO_DADOS_GUARDADOS } from './eventos';

// A API é sempre chamada pelo mesmo domínio do front: em produção um rewrite
// da Vercel (vercel.json) encaminha /api/* para o backend, e em dev o proxy do
// Vite faz o mesmo para localhost:3333. Assim não há CORS nem dependência de
// qual domínio o backend está publicado.
//
// A sessão viaja num cookie HttpOnly que o servidor grava no login: a tela
// não guarda nem lê o token (um script injetado na página não o leva embora).
// O cabeçalho `X-Conserva` é o que a API exige em toda escrita autenticada
// por cookie — um formulário de outro site não consegue mandá-lo.
const api = axios.create({
  baseURL: '/api',
  headers: { 'X-Conserva': '1' },
});

// Quem chama sabe se há alguém logado por isto, que não é segredo nenhum: é o
// nome e o perfil, para desenhar a tela. A prova de identidade é o cookie.
export const CHAVE_USUARIO = 'smp_usuario';

// Aviso de que o token deixou de valer. O interceptor não tem acesso ao estado
// do React, e limpar só o localStorage não bastava: o AuthContext continuava
// com o usuário em memória, a rota protegida seguia renderizando e a tela
// enchia de erro sem nunca voltar para o login.
export const EVENTO_SESSAO_EXPIRADA = 'smp:sessao-expirada';

// A administração passou a exigir a verificação em duas etapas da gestão e
// esta conta ainda não ligou: a API recusa tudo fora de Minha conta, e a tela
// leva a pessoa para lá (AuthContext, RotaProtegida). Vale também para quem já
// estava logado quando a exigência foi ligada.
export const EVENTO_2FA_OBRIGATORIO = 'smp:2fa-obrigatorio';


export const MENSAGEM_SEM_CONEXAO =
  'Sem conexão com o servidor: nada foi registrado. Tente de novo quando a conexão voltar.';

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
    const url = error.config?.url ?? '';
    const ehTentativaDeLogin = url.includes('/auth/login') || url.includes('/auth/google');
    const tinhaSessao = Boolean(localStorage.getItem(CHAVE_USUARIO));

    if (error.response?.status === 401 && tinhaSessao && !ehTentativaDeLogin) {
      localStorage.removeItem(CHAVE_USUARIO);
      window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIRADA));
    }

    if (error.response?.status === 403 && error.response.data?.erro?.codigo === 'DOIS_FATORES_OBRIGATORIO') {
      window.dispatchEvent(new Event(EVENTO_2FA_OBRIGATORIO));
    }

    return Promise.reject(error);
  }
);

/**
 * Baixa um arquivo servido pela API.
 *
 * Pelo axios, e não por link direto: assim um erro (permissão, período
 * inválido) volta como mensagem na tela em vez de uma aba com JSON cru. O
 * nome vem do Content-Disposition — é o servidor que decide como o arquivo se
 * chama, e repetir a regra aqui criaria duas verdades.
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
