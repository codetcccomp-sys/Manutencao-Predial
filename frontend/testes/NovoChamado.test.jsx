import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('../src/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

import api from '../src/api/client';
import NovoChamado from '../src/pages/NovoChamado';
import { PERGUNTAS_DE_SITUACAO } from '../src/dominio/situacao';

/**
 * A prioridade não é mais escolhida na abertura (RF04): a pessoa responde sobre a situação
 * (risco, impacto e urgência) e o servidor calcula. O seletor "Prioridade" com "baixa"
 * marcada fazia um elevador parado esperar 168 horas sem disparar o alerta de 15 minutos.
 */

function abrir() {
  api.get.mockImplementation(async (caminho) => {
    if (caminho === '/categorias') return { data: { categorias: [{ id: 10, nome: 'elétrica' }] } };
    if (caminho === '/locais') return { data: { locais: [{ id: 1, unidade: 'Prédio A' }] } };
    return { data: { equipamentos: [] } };
  });
  api.post.mockReset();
  api.post.mockResolvedValue({ data: { chamado: { id: 123 } } });
  return render(
    <MemoryRouter initialEntries={['/chamados/novo']}>
      <Routes>
        <Route path="/chamados/novo" element={<NovoChamado />} />
        <Route path="/chamados/:id" element={<p>Chamado aberto</p>} />
      </Routes>
    </MemoryRouter>
  );
}

async function preencherOResto(usuario) {
  await screen.findByRole('option', { name: 'Prédio A' });
  await usuario.type(screen.getByLabelText('Título'), 'Elevador parado');
  await usuario.type(screen.getByLabelText('Descrição'), 'Parou entre o 2º e o 3º andar.');
  await usuario.selectOptions(screen.getByLabelText('Categoria'), '10');
  await usuario.selectOptions(screen.getByLabelText('Local'), '1');
}

function grupo(pergunta) {
  return screen.getByRole('group', { name: pergunta });
}

describe('Situação do chamado (urgência, impacto e risco)', () => {
  it('não há seletor de prioridade, e nenhuma resposta vem marcada', async () => {
    abrir();
    await screen.findByRole('option', { name: 'Prédio A' });

    expect(screen.queryByLabelText('Prioridade')).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(12);
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
  });

  it('cada pergunta é um grupo nomeado, com as quatro opções do mais leve ao mais grave', async () => {
    abrir();
    await screen.findByRole('option', { name: 'Prédio A' });

    for (const { pergunta, opcoes } of PERGUNTAS_DE_SITUACAO) {
      const radios = within(grupo(pergunta)).getAllByRole('radio');
      expect(radios.map((r) => Number(r.value))).toEqual([1, 2, 3, 4]);
      expect(radios.map((r) => r.closest('label').textContent)).toEqual(opcoes.map((o) => o.texto));
    }
  });

  it('sem responder, o chamado não é enviado', async () => {
    const usuario = userEvent.setup();
    abrir();
    await preencherOResto(usuario);

    await usuario.click(screen.getByRole('button', { name: 'Abrir chamado' }));

    expect(api.post).not.toHaveBeenCalled();
  });

  it('com uma pergunta sem resposta, também não', async () => {
    const usuario = userEvent.setup();
    abrir();
    await preencherOResto(usuario);
    await usuario.click(within(grupo(PERGUNTAS_DE_SITUACAO[0].pergunta)).getByRole('radio', { name: 'Não' }));
    await usuario.click(
      within(grupo(PERGUNTAS_DE_SITUACAO[1].pergunta)).getByRole('radio', { name: 'Só incomoda; tudo funciona' })
    );

    await usuario.click(screen.getByRole('button', { name: 'Abrir chamado' }));

    expect(api.post).not.toHaveBeenCalled();
  });

  it('envia urgência, impacto e risco como números e nenhuma prioridade', async () => {
    const usuario = userEvent.setup();
    abrir();
    await preencherOResto(usuario);

    await usuario.click(
      within(grupo(PERGUNTAS_DE_SITUACAO[0].pergunta)).getByRole('radio', { name: 'Risco para pessoas agora' })
    );
    await usuario.click(
      within(grupo(PERGUNTAS_DE_SITUACAO[1].pergunta)).getByRole('radio', {
        name: 'Uma sala ou um serviço não pode ser usado',
      })
    );
    await usuario.click(
      within(grupo(PERGUNTAS_DE_SITUACAO[2].pergunta)).getByRole('radio', { name: 'Agora, não pode esperar' })
    );
    await usuario.click(screen.getByRole('button', { name: 'Abrir chamado' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [caminho, corpo] = api.post.mock.calls[0];
    expect(caminho).toBe('/chamados');
    expect(corpo).toMatchObject({ risco: 4, impacto: 3, urgencia: 4, categoria_id: 10, local_id: 1 });
    expect(corpo).not.toHaveProperty('prioridade');
    expect(await screen.findByText('Chamado aberto')).toBeInTheDocument();
  });

  it('trocar a resposta de uma pergunta mantém uma opção só marcada nela', async () => {
    const usuario = userEvent.setup();
    abrir();
    await screen.findByRole('option', { name: 'Prédio A' });
    const urgencia = within(grupo(PERGUNTAS_DE_SITUACAO[2].pergunta));

    await usuario.click(urgencia.getByRole('radio', { name: 'Hoje' }));
    await usuario.click(urgencia.getByRole('radio', { name: 'Nesta semana' }));

    expect(urgencia.getByRole('radio', { name: 'Nesta semana' })).toBeChecked();
    expect(urgencia.getByRole('radio', { name: 'Hoje' })).not.toBeChecked();
  });
});
