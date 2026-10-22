import { describe, expect, it } from 'vitest';
import { conferirDemonstracao, resolverDestino } from '../video/destino.mjs';

/**
 * Para onde o semeador (video/semear.mjs) escreve. Ele cria contas e chamados
 * pela API; o que se testa aqui é que não chega a escrever onde não deve.
 */

const DEMO = 'https://conserva-predial-demo-api.vercel.app';
const CREDENCIAIS = { SEMEAR_ADMIN_EMAIL: 'a@demo.exemplo.com', SEMEAR_ADMIN_SENHA: 'x', SEMEAR_SENHA: 'y' };

describe('resolverDestino', () => {
  it('no banco local do vídeo, usa os valores de sempre', () => {
    expect(resolverDestino({})).toEqual({
      api: 'http://localhost:3333',
      local: true,
      adminEmail: 'admin_video@exemplo.com',
      adminSenha: 'senha_video_local',
      senha: 'senha-teste-123',
      cron: 'video',
    });
  });

  it('recusa o endereço da produção, em qualquer um dos nomes que a Vercel dá', () => {
    for (const api of [
      'https://conserva-predial.vercel.app',
      'https://manutencao-predial-backend-delta.vercel.app',
      'https://manutencao-predial-frontend-tec-code.vercel.app',
      'https://MANUTENCAO-PREDIAL-BACKEND.vercel.app/',
    ]) {
      expect(() => resolverDestino({ API: api, ...CREDENCIAIS }), api).toThrow(/PRODUÇÃO/);
    }
  });

  it('aceita o endereço da demonstração: o nome com "-demo" não é o da produção', () => {
    expect(resolverDestino({ API: `${DEMO}/`, ...CREDENCIAIS })).toMatchObject({ api: DEMO, local: false });
  });

  it('API publicada exige https', () => {
    expect(() => resolverDestino({ API: 'http://api-qualquer.example', ...CREDENCIAIS })).toThrow(/https/);
  });

  it('fora do banco local não há credencial padrão — e segredo vazio vale como ausente', () => {
    expect(() => resolverDestino({ API: DEMO })).toThrow(/SEMEAR_ADMIN_EMAIL.*SEMEAR_ADMIN_SENHA.*SEMEAR_SENHA/);
    expect(() => resolverDestino({ API: DEMO, ...CREDENCIAIS, SEMEAR_ADMIN_SENHA: '' })).toThrow(/SEMEAR_ADMIN_SENHA/);
  });

  it('fora do banco local, sem o segredo do agendador as tarefas simplesmente não rodam', () => {
    expect(resolverDestino({ API: DEMO, ...CREDENCIAIS }).cron).toBeUndefined();
    expect(resolverDestino({ API: DEMO, ...CREDENCIAIS, SEMEAR_CRON_SECRET: 's' }).cron).toBe('s');
  });
});

describe('conferirDemonstracao', () => {
  const responde = (corpo) => async () => ({ json: async () => corpo });

  it('segue quando o banco da API diz que é de demonstração', async () => {
    await expect(conferirDemonstracao(DEMO, responde({ demonstracao: true }))).resolves.toBeUndefined();
  });

  it('recusa quando a API não diz, diz que não, ou não responde', async () => {
    for (const buscar of [
      responde({ status: 'ok' }),
      responde({ demonstracao: false }),
      responde({ demonstracao: 'true' }),
      async () => {
        throw new Error('rede');
      },
      async () => ({ json: async () => Promise.reject(new Error('não é JSON')) }),
    ]) {
      await expect(conferirDemonstracao(DEMO, buscar)).rejects.toThrow(/não confirma ser uma API de demonstração/);
    }
  });
});
