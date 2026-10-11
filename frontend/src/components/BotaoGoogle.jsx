import { useEffect, useRef, useState } from 'react';
import api from '../api/client';

/**
 * O botão "Fazer login com o Google", do próprio Google (Google Identity
 * Services).
 *
 * Só aparece quando a instalação tem o ID do cliente configurado no servidor
 * (GOOGLE_CLIENT_ID): sem ele, o script do Google nem é carregado. O botão
 * entrega uma credencial assinada pelo Google, e quem a confere é o servidor
 * (google.service) — a tela só a repassa.
 *
 * O script vem de accounts.google.com, liberado na CSP (vercel.json) só nos
 * endereços que o Google documenta para este botão.
 *
 * O botão tem largura em pixels (o Google o desenha num iframe de largura
 * fixa, entre 200 e 400), então ele precisa acompanhar o espaço que tem. A
 * largura era medida uma vez, ao carregar: quem abria o login com o celular
 * deitado e girava para ficar em pé via o botão de 318 px num cartão de 288,
 * e como a coluna do formulário esticava junto, os campos e o "Entrar"
 * passavam do cartão e da tela. Agora o botão é redesenhado quando o espaço
 * muda, e o contêiner não deixa uma largura fixa esticar a coluna.
 */

const SCRIPT = 'https://accounts.google.com/gsi/client';
let carregamento = null;

// Limites de largura do botão, definidos pelo Google.
const LARGURA_MINIMA = 200;
const LARGURA_MAXIMA = 400;
// Arrastar a borda da janela dispara dezenas de medições por segundo, e cada
// redesenho recarrega o iframe do Google: espera a medida assentar.
const ESPERA_MS = 150;

const larguraPara = (lugar) =>
  Math.max(LARGURA_MINIMA, Math.min(Math.floor(lugar.clientWidth) || 320, LARGURA_MAXIMA));

function carregarScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!carregamento) {
    carregamento = new Promise((resolver, rejeitar) => {
      const script = document.createElement('script');
      script.src = SCRIPT;
      script.async = true;
      script.onload = () => resolver();
      script.onerror = () => {
        carregamento = null;
        rejeitar(new Error('script do Google não carregou'));
      };
      document.head.appendChild(script);
    });
  }
  return carregamento;
}

function BotaoGoogle({ onCredencial }) {
  const [clienteId, setClienteId] = useState(null);
  const [falhou, setFalhou] = useState(false);
  const lugar = useRef(null);
  // O Google guarda a função do primeiro `initialize`; a referência deixa a
  // tela trocar a função a cada renderização sem reinicializar o botão.
  const retorno = useRef(onCredencial);
  retorno.current = onCredencial;

  useEffect(() => {
    let vivo = true;
    api
      .get('/auth/google')
      .then(({ data }) => vivo && setClienteId(data.client_id || null))
      // Sem resposta, o login por e-mail e senha continua: o botão é extra.
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    if (!clienteId) return undefined;
    let vivo = true;
    let observador;
    let espera;
    let ultimaLargura = null;

    // Só redesenha quando a largura mudou. Limpa antes: não dá para contar com
    // o Google trocar o botão antigo em vez de empilhar o novo ao lado.
    const desenhar = () => {
      if (!vivo || !lugar.current) return;
      const largura = larguraPara(lugar.current);
      if (largura === ultimaLargura) return;
      ultimaLargura = largura;
      lugar.current.replaceChildren();
      window.google.accounts.id.renderButton(lugar.current, {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        locale: 'pt-BR',
        width: largura,
      });
    };

    carregarScript()
      .then(() => {
        if (!vivo || !lugar.current) return;
        window.google.accounts.id.initialize({
          client_id: clienteId,
          callback: (resposta) => retorno.current(resposta.credential),
          ux_mode: 'popup',
        });
        desenhar();
        if (typeof ResizeObserver !== 'undefined') {
          observador = new ResizeObserver(() => {
            clearTimeout(espera);
            espera = setTimeout(desenhar, ESPERA_MS);
          });
          observador.observe(lugar.current);
        }
      })
      .catch(() => vivo && setFalhou(true));
    return () => {
      vivo = false;
      clearTimeout(espera);
      observador?.disconnect();
    };
  }, [clienteId]);

  if (!clienteId || falhou) return null;

  return (
    // min-w-0 nos dois níveis: item de grade tem largura mínima igual ao
    // conteúdo, e o conteúdo aqui é um iframe de largura fixa. Sem isto, ele
    // alarga a coluna do formulário inteiro (campos e "Entrar" junto).
    <div className="grid min-w-0 gap-3">
      <div className="flex items-center gap-3 text-xs text-tinta-2" aria-hidden="true">
        <span className="h-px flex-1 bg-borda" />
        ou
        <span className="h-px flex-1 bg-borda" />
      </div>
      <div
        ref={lugar}
        className="flex min-h-[44px] min-w-0 justify-center overflow-hidden"
        data-testid="botao-google"
      />
    </div>
  );
}

export default BotaoGoogle;
