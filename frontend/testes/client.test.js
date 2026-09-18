import { describe, expect, it, vi, beforeEach } from 'vitest';
import api, { EVENTO_SESSAO_EXPIRADA, baixarArquivo } from '../src/api/client';

/**
 * O interceptor e o download são o encanamento que toda tela usa. Não têm
 * tela própria para alguém notar quando quebram: um erro aqui aparece como
 * "o app travou" numa página qualquer, três semanas depois.
 */

function erroDe(status, { url = '/chamados', data } = {}) {
  return Promise.reject({ response: { status, data }, config: { url } });
}

describe('Sessão expirada', () => {
  let avisado;

  beforeEach(() => {
    avisado = false;
    window.addEventListener(EVENTO_SESSAO_EXPIRADA, () => {
      avisado = true;
    });
  });

  async function passarPeloInterceptor(promessa) {
    const [aoErrar] = api.interceptors.response.handlers.filter(Boolean).map((h) => h.rejected);
    try {
      await promessa;
    } catch (err) {
      await aoErrar(err).catch(() => {});
    }
  }

  it('401 com sessão em curso limpa o armazenamento e avisa', async () => {
    localStorage.setItem('smp_token', 'token-antigo');
    localStorage.setItem('smp_usuario', '{"nome":"Alguém"}');

    await passarPeloInterceptor(erroDe(401));

    expect(avisado).toBe(true);
    expect(localStorage.getItem('smp_token')).toBeNull();
    expect(localStorage.getItem('smp_usuario')).toBeNull();
  });

  it('401 no próprio login é credencial recusada, não sessão expirada', async () => {
    // O token precisa existir aqui, senão o teste passa pelo motivo errado:
    // sem sessão guardada o aviso não dispararia de qualquer jeito, e a
    // exceção do /auth/login — que é o que este teste verifica — poderia ser
    // removida sem ninguém notar. (Foi o que um teste de mutação mostrou.)
    // O cenário é real: um token vencido sobra no armazenamento e a pessoa
    // erra a senha ao entrar de novo.
    localStorage.setItem('smp_token', 'token-vencido');

    await passarPeloInterceptor(erroDe(401, { url: '/auth/login' }));

    expect(avisado).toBe(false);
    // E a tela de login não pode anunciar "sua sessão expirou" a cada senha
    // errada.
  });

  it('401 sem token guardado não dispara o aviso', async () => {
    await passarPeloInterceptor(erroDe(401));
    expect(avisado).toBe(false);
  });

  it('403 não é sessão expirada', async () => {
    localStorage.setItem('smp_token', 'token');
    await passarPeloInterceptor(erroDe(403));

    // Acesso negado por perfil não invalida a sessão; derrubar o usuário aqui
    // o mandaria para o login sem motivo.
    expect(avisado).toBe(false);
    expect(localStorage.getItem('smp_token')).toBe('token');
  });
});

describe('Download de arquivo', () => {
  it('usa o nome que o servidor mandou no Content-Disposition', async () => {
    const clicar = vi.fn();
    vi.spyOn(document, 'createElement').mockReturnValue({ click: clicar, set href(v) {}, download: '' });
    const link = { click: clicar, href: '', download: '' };
    document.createElement.mockReturnValue(link);

    vi.spyOn(api, 'get').mockResolvedValue({
      data: new Blob(['a;b'], { type: 'text/csv' }),
      headers: { 'content-disposition': 'attachment; filename="chamados_2026-01-01.csv"' },
    });

    await baixarArquivo('/relatorios/exportar/chamados.csv', {});

    // O servidor é quem decide o nome; repetir a regra aqui criaria duas
    // verdades que divergem na primeira mudança.
    expect(link.download).toBe('chamados_2026-01-01.csv');
    expect(clicar).toHaveBeenCalled();
    document.createElement.mockRestore();
  });

  it('desembrulha o erro que veio como blob', async () => {
    const corpo = new Blob([JSON.stringify({ erro: { mensagem: 'Informe um período menor.' } })], {
      type: 'application/json',
    });
    vi.spyOn(api, 'get').mockRejectedValue({ response: { data: corpo } });

    // Pedida como blob, a recusa do servidor chega como blob mesmo sendo
    // JSON; sem desembrulhar, a tela mostraria "[object Blob]".
    await expect(baixarArquivo('/relatorios/exportar/chamados.csv', {})).rejects.toThrow(
      'Informe um período menor.'
    );
  });

  it('erro sem corpo conhecido vira mensagem legível', async () => {
    vi.spyOn(api, 'get').mockRejectedValue({ message: 'Network Error' });

    await expect(baixarArquivo('/relatorios/exportar/resumo.pdf', {})).rejects.toThrow(
      'Não foi possível gerar o arquivo.'
    );
  });
});
