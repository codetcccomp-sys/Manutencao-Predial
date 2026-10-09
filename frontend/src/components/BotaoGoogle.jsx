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
 */

const SCRIPT = 'https://accounts.google.com/gsi/client';
let carregamento = null;

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
    carregarScript()
      .then(() => {
        if (!vivo || !lugar.current) return;
        window.google.accounts.id.initialize({
          client_id: clienteId,
          callback: (resposta) => retorno.current(resposta.credential),
          ux_mode: 'popup',
        });
        window.google.accounts.id.renderButton(lugar.current, {
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          locale: 'pt-BR',
          width: Math.min(lugar.current.offsetWidth || 320, 400),
        });
      })
      .catch(() => vivo && setFalhou(true));
    return () => {
      vivo = false;
    };
  }, [clienteId]);

  if (!clienteId || falhou) return null;

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3 text-xs text-tinta-2" aria-hidden="true">
        <span className="h-px flex-1 bg-borda" />
        ou
        <span className="h-px flex-1 bg-borda" />
      </div>
      <div ref={lugar} className="flex min-h-[44px] justify-center" data-testid="botao-google" />
    </div>
  );
}

export default BotaoGoogle;
