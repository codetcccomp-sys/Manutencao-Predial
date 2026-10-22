#!/usr/bin/env node
/**
 * Teste de mutação, à mão e de propósito.
 *
 * Um teste que passa não prova nada sozinho: ele pode estar passando pelo
 * motivo errado. Aqui cada mutação quebra um comportamento específico do
 * código e confere que a suíte acusa. O que não for acusado é um teste
 * decorativo — e foi assim que se descobriu que a exceção do /auth/login no
 * interceptor podia ser apagada sem nenhum teste reclamar.
 *
 * Não roda no CI: é uma ferramenta para usar ao escrever ou revisar testes,
 * porque leva o tempo da suíte multiplicado pelo número de mutações.
 *
 * Uso:
 *   node testes/mutacao.mjs              todas
 *   node testes/mutacao.mjs vitest       só as que rodam em jsdom (rápidas)
 *   node testes/mutacao.mjs playwright   só as de layout (reconstroem a build)
 *   node testes/mutacao.mjs todas UX:    só as cuja descrição contém o texto
 */
import { execSync } from 'child_process';
import fs from 'fs';

const MUTACOES = [
  {
    descricao: 'técnico volta a ver o botão de cancelar (RN05)',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: "(estado) => podeGerenciar || estado !== 'cancelado'",
    para: '() => true',
    spec: 'testes/ChamadoDetalhe.test.jsx',
  },
  {
    descricao: 'cabeçalho volta a mostrar o perfil como chave crua',
    arquivo: 'src/dominio/rotulos.js',
    de: 'return PERFIS[perfil] ?? perfil;',
    para: 'return perfil;',
    spec: 'testes/Marca.test.jsx',
  },
  {
    descricao: 'interceptor deixa de excetuar o /auth/login',
    arquivo: 'src/api/client.js',
    de: "const ehTentativaDeLogin = error.config?.url?.includes('/auth/login');",
    para: 'const ehTentativaDeLogin = false;',
    spec: 'testes/client.test.js',
  },
  {
    descricao: 'interceptor dispara mesmo sem sessão guardada',
    arquivo: 'src/api/client.js',
    de: 'const tinhaSessao = Boolean(localStorage.getItem(CHAVE_USUARIO));',
    para: 'const tinhaSessao = true;',
    spec: 'testes/client.test.js',
  },
  {
    descricao: 'download ignora o nome vindo do servidor',
    arquivo: 'src/api/client.js',
    de: `const nome = /filename="([^"]+)"/.exec(disposicao)?.[1] || 'download';`,
    para: `const nome = 'download';`,
    spec: 'testes/client.test.js',
  },
  {
    descricao: 'download não desembrulha o erro que veio como blob',
    arquivo: 'src/api/client.js',
    de: "if (corpo instanceof Blob && corpo.type.includes('json')) {",
    para: 'if (false) {',
    spec: 'testes/client.test.js',
  },
  {
    descricao: 'sino deixa de cortar o contador em 9+',
    arquivo: 'src/components/Avisos.jsx',
    de: "{naoLidas > 9 ? '9+' : naoLidas}",
    para: '{naoLidas}',
    spec: 'testes/Avisos.test.jsx',
  },
  {
    descricao: 'sino conta as lidas junto com as não lidas',
    arquivo: 'src/components/Avisos.jsx',
    de: 'const naoLidas = avisos.filter((a) => !a.lida).length;',
    para: 'const naoLidas = avisos.length;',
    spec: 'testes/Avisos.test.jsx',
  },
  {
    descricao: 'sino marca como lida uma notificação já lida',
    arquivo: 'src/components/Avisos.jsx',
    de: 'if (!aviso.lida) {',
    para: 'if (true) {',
    spec: 'testes/Avisos.test.jsx',
  },
  {
    descricao: 'painel não prende a posição dentro da tela',
    arquivo: 'src/components/Avisos.jsx',
    de: 'left: Math.max(MARGEM_TELA, Math.min(r.right - largura, limiteDireito)),',
    para: 'left: r.right - largura,',
    // Geometria não existe no jsdom: só o navegador acusa.
    motor: 'playwright',
    spec: 'e2e/layout.spec.js',
  },
  {
    descricao: 'filtro de locais deixa de filtrar',
    arquivo: 'src/pages/Cadastros.jsx',
    de: '? locais.filter((l) => rotuloLocal(l).toLowerCase().includes(termo))',
    para: '? locais',
    spec: 'testes/Cadastros.test.jsx',
  },
  {
    descricao: 'busca do painel deixa de ser enviada à API',
    arquivo: 'src/pages/Dashboard.jsx',
    de: '...(buscaAplicada ? { busca: buscaAplicada } : {}),',
    para: '',
    spec: 'testes/Dashboard.test.jsx',
  },
  {
    descricao: 'busca deixa de esperar a digitação parar',
    arquivo: 'src/pages/Dashboard.jsx',
    de: '}, 400);',
    para: '}, 0);',
    spec: 'testes/Dashboard.test.jsx',
  },
  {
    // Estava DESATUALIZADA antes de o cartão sair do Dashboard: o trecho que
    // ela procurava deixou de existir no redesenho, e a suíte passou a
    // reportar falha sem que ninguém notasse. Agora mira o componente
    // partilhado, que é onde o cartão vive nas três telas por perfil.
    descricao: 'cartão de chamado deixa de encolher',
    arquivo: 'src/components/chamados/CartaoDeChamado.jsx',
    de: 'className="flex min-w-0 flex-1 flex-col items-start gap-3',
    para: 'className="flex flex-1 flex-col items-start gap-3',
    motor: 'playwright',
    spec: 'e2e/layout.spec.js',
  },
  {
    // Também estava DESATUALIZADA na main: a classe mudou no redesenho. E a
    // classe nova se repete em cinco selects da mesma tela — o harness troca
    // só a primeira ocorrência, então o trecho começa no fim do comentário
    // que só o select de técnico tem, para mutar o select certo.
    descricao: 'select de técnico deixa de encolher',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: `comprido esticava a página inteira no celular. */
                className="w-full min-w-0 rounded`,
    para: `comprido esticava a página inteira no celular. */
                className="rounded`,
    motor: 'playwright',
    spec: 'e2e/layout.spec.js',
  },
  {
    descricao: 'anexos e comentários voltam a ser pedidos em paralelo',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: `carregar().then((carregou) => {
      if (!carregou) return;`,
    para: 'carregar().then(() => {',
    spec: 'testes/ChamadoDetalhe.test.jsx',
  },
  {
    descricao: 'importação lê a planilha sempre como UTF-8',
    arquivo: 'src/pages/Cadastros.jsx',
    de: `    return new TextDecoder('windows-1252').decode(bytes);`,
    para: `    return new TextDecoder('utf-8').decode(bytes);`,
    spec: 'testes/Cadastros.test.jsx',
  },
  {
    descricao: 'importação engole a lista de problemas do arquivo',
    arquivo: 'src/pages/Cadastros.jsx',
    de: 'setProblemas(corpo?.detalhes || []);',
    para: 'setProblemas([]);',
    spec: 'testes/Cadastros.test.jsx',
  },
  {
    descricao: 'importação não recarrega a lista de locais',
    arquivo: 'src/pages/Cadastros.jsx',
    de: `      setRelatorio(data.relatorio);
      carregar();`,
    para: '      setRelatorio(data.relatorio);',
    spec: 'testes/Cadastros.test.jsx',
  },
  {
    // O defeito que existia de verdade: os dois estados tinham o mesmo par de
    // cor e ficavam indistinguíveis na tela.
    descricao: 'atribuído e em andamento voltam a ser idênticos',
    arquivo: 'src/dominio/rotulos.js',
    de: `    icone: 'chave',
    cor: 'bg-andamento-tenue text-andamento',`,
    para: `    icone: 'pessoa',
    cor: 'bg-info-tenue text-info',`,
    spec: 'testes/Badge.test.jsx',
  },
  {
    descricao: 'badge de estado perde o ícone e volta a depender de cor e texto',
    arquivo: 'src/components/ui/Badge.jsx',
    de: '      <Icone nome={definicao.icone} classe="h-3.5 w-3.5" />\n',
    para: '',
    spec: 'testes/Badge.test.jsx',
  },
  {
    descricao: 'escada de prioridade acende todas as barras',
    arquivo: 'src/components/ui/Icone.jsx',
    de: 'opacity={i < nivel ? 1 : 0.25}',
    para: 'opacity={1}',
    spec: 'testes/Badge.test.jsx',
  },
  {
    // Renomearia o campo: "Bloco" viraria "Bloco (opcional)" para leitor de
    // tela e para qualquer busca por rótulo.
    descricao: 'marca de opcional entra no nome acessível do campo',
    arquivo: 'src/components/ui/Campo.jsx',
    de: `        <label htmlFor={id} className="text-sm font-medium text-tinta">
          {rotulo}
        </label>
        {opcional && <span className="text-xs text-tinta-2">(opcional)</span>}`,
    para: `        <label htmlFor={id} className="text-sm font-medium text-tinta">
          {rotulo}
          {opcional && <span className="text-xs text-tinta-2"> (opcional)</span>}
        </label>`,
    spec: 'testes/Campo.test.jsx',
  },
  {
    descricao: 'erro do campo deixa de ser lido junto dele',
    arquivo: 'src/components/ui/Campo.jsx',
    de: '  const partes = [ajuda && `${id}-ajuda`, erro && `${id}-erro`].filter(Boolean);',
    para: '  const partes = [ajuda && `${id}-ajuda`].filter(Boolean);',
    spec: 'testes/Campo.test.jsx',
  },
  {
    descricao: 'botão volta a enviar o formulário sem pedirem',
    arquivo: 'src/components/ui/Botao.jsx',
    de: '      type="button"',
    para: '      type={resto.type}',
    spec: 'testes/Campo.test.jsx',
  },
  {
    // O estado original do sistema: dezessete faixas de erro, nenhuma
    // anunciada por leitor de tela.
    descricao: 'faixa de erro perde o papel e deixa de ser anunciada',
    arquivo: 'src/components/ui/Aviso.jsx',
    de: "  erro: { cor: 'bg-erro-tenue text-erro', icone: 'alerta', papel: 'alert' },",
    para: "  erro: { cor: 'bg-erro-tenue text-erro', icone: 'alerta', papel: undefined },",
    spec: 'testes/Campo.test.jsx',
  },
  {
    descricao: 'estado vazio deixa de distinguir filtro de lista vazia',
    arquivo: 'src/pages/Dashboard.jsx',
    de: `              temFiltro
                ? 'Os filtros ativos podem estar estreitando demais o resultado.'
                : 'Quando alguém abrir um chamado, ele aparece aqui.'`,
    para: `              'Quando alguém abrir um chamado, ele aparece aqui.'`,
    spec: 'testes/Dashboard.test.jsx',
  },
  {
    // Esta passou batido na primeira tentativa: o teste limpava um filtro só.
    descricao: 'limpar filtros esquece o estado selecionado',
    arquivo: 'src/pages/Dashboard.jsx',
    de: `    setBusca('');
    setEstado('');
    setSomenteAtrasados(false);`,
    para: `    setBusca('');
    setSomenteAtrasados(false);`,
    spec: 'testes/Dashboard.test.jsx',
  },
  {
    descricao: 'esqueleto deixa de ser escondido do leitor de tela',
    arquivo: 'src/components/ui/Estados.jsx',
    de: '      aria-hidden="true"',
    para: '      aria-hidden={undefined}',
    spec: 'testes/Dashboard.test.jsx',
  },
  {
    descricao: 'título da página volta a ser h2, sem h1 na árvore',
    arquivo: 'src/components/ui/CabecalhoDePagina.jsx',
    de: '        <h1 className="text-lg font-bold text-navy">{titulo}</h1>',
    para: '        <h2 className="text-lg font-bold text-navy">{titulo}</h2>',
    spec: 'testes/Dashboard.test.jsx',
  },
  {
    descricao: 'histórico volta a mostrar a chave crua do banco',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: '<strong>{rotuloEstado(h.estado_novo)}</strong>',
    para: '<strong>{h.estado_novo}</strong>',
    spec: 'testes/ChamadoDetalhe.test.jsx',
  },
  {
    descricao: 'histórico volta a nascer aberto, empurrando o uso diário',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: '<details className="group bg-superficie',
    para: '<details open className="group bg-superficie',
    spec: 'testes/ChamadoDetalhe.test.jsx',
  },
  {
    descricao: 'painel do chamado volta a h3, pulando o nível 2 da árvore',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: '<h2 className="font-medium text-navy">Comentários</h2>',
    para: '<h3 className="font-medium text-navy">Comentários</h3>',
    spec: 'testes/ChamadoDetalhe.test.jsx',
  },
  {
    descricao: 'título do chamado deixa de ser o h1 da tela',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: '<h1 className="text-lg font-bold text-navy">{chamado.titulo}</h1>',
    para: '<h2 className="text-lg font-bold text-navy">{chamado.titulo}</h2>',
    spec: 'testes/ChamadoDetalhe.test.jsx',
  },
  {
    descricao: 'painel de cadastro volta a h3, pulando o nível 2 da árvore',
    arquivo: 'src/pages/Cadastros.jsx',
    de: '<h2 className="font-medium text-navy">Cadastrar local</h2>',
    para: '<h3 className="font-medium text-navy">Cadastrar local</h3>',
    spec: 'testes/Cadastros.test.jsx',
  },
  {
    descricao: 'cancelar o chamado volta a ser um clique só, sem perguntar',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: "    if (estado === 'cancelado') {",
    para: '    if (false) {',
    spec: 'testes/ChamadoDetalhe.test.jsx',
  },
  {
    descricao: 'remover anexo deixa de dizer qual arquivo some',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: 'descricao: `"${a.nome_arquivo}" será apagado do chamado. Não há como recuperá-lo depois.`,',
    para: "descricao: 'O anexo será apagado do chamado.',",
    spec: 'testes/ChamadoDetalhe.test.jsx',
  },
  {
    descricao: 'o foco do diálogo começa no botão que executa',
    arquivo: 'src/components/ui/useJanelaModal.js',
    de: '    caixa.current?.querySelector(focoInicial)?.focus();',
    para: "    [...caixa.current.querySelectorAll('button')].at(-1)?.focus();",
    spec: 'testes/Confirmacao.test.jsx',
  },
  {
    descricao: 'o Tab volta a escapar do diálogo para a página atrás dele',
    arquivo: 'src/components/ui/useJanelaModal.js',
    de: "      if (evento.key !== 'Tab') return;",
    para: '      return;',
    spec: 'testes/Confirmacao.test.jsx',
  },
  {
    descricao: 'Esc deixa de fechar o diálogo',
    arquivo: 'src/components/ui/useJanelaModal.js',
    de: "      if (evento.key === 'Escape') {",
    para: '      if (false) {',
    spec: 'testes/Confirmacao.test.jsx',
  },
  {
    descricao: 'o foco não volta para o botão que abriu o diálogo',
    arquivo: 'src/components/ui/useJanelaModal.js',
    de: '      if (origemDoFoco.current?.isConnected) origemDoFoco.current.focus();',
    para: '      /* sem devolver o foco */',
    spec: 'testes/Confirmacao.test.jsx',
  },
  {
    descricao: 'símbolo da marca ganha alt e faz o nome ser anunciado duas vezes',
    arquivo: 'src/components/ui/Marca.jsx',
    de: '        alt=""',
    para: '        alt="Conserva Predial"',
    spec: 'testes/Marca.test.jsx',
  },
  {
    descricao: 'nome do sistema volta a ser parte da imagem, sem texto',
    arquivo: 'src/components/ui/Marca.jsx',
    de: '          Conserva <span className={invertido ? \'text-amber-claro\' : \'text-amber\'}>Predial</span>',
    para: '          {null}',
    spec: 'testes/Marca.test.jsx',
  },
  {
    descricao: 'a barra do navegador desgarra da cor do cabeçalho',
    arquivo: 'index.html',
    de: '<meta name="theme-color" content="#1f3864" />',
    para: '<meta name="theme-color" content="#123456" />',
    spec: 'testes/contraste.test.js',
  },
  {
    descricao: 'lista de problemas da importação perde o papel de alerta',
    arquivo: 'src/pages/Cadastros.jsx',
    de: '<Aviso tipo="erro" titulo="Nada foi importado. Corrija e envie o arquivo de novo:">',
    para: '<Aviso tipo="info" titulo="Nada foi importado. Corrija e envie o arquivo de novo:">',
    spec: 'testes/Cadastros.test.jsx',
  },
  {
    descricao: 'foco volta para trás do diálogo enquanto a ação corre',
    arquivo: 'src/components/ui/useJanelaModal.js',
    de: '  }, [aberto]);',
    para: '  }, [aberto, aoFechar]);',
    spec: 'testes/Confirmacao.test.jsx',
  },
  {
    descricao: 'seletor de perfil volta a depender de id, que a tabela duplica',
    arquivo: 'src/pages/Usuarios.jsx',
    de: '                    aria-label={`Perfil de ${u.nome}`}',
    para: '                    id={`perfil-${u.id}`}',
    spec: 'testes/Usuarios.test.jsx',
  },
  {
    descricao: 'entrada animada deixa filter/transform residuais nos itens',
    arquivo: 'src/animacao/useEntrada.js',
    de: "clearProps: 'opacity,transform,filter',",
    para: '',
    spec: 'testes/animacao.test.jsx',
  },
  {
    descricao: 'contagem deixa de formatar no padrão brasileiro',
    arquivo: 'src/animacao/NumeroAnimado.jsx',
    de: "Math.round(n).toLocaleString('pt-BR')",
    para: 'String(Math.round(n))',
    spec: 'testes/animacao.test.jsx',
  },
  {
    descricao: 'contagem volta a pular para o final no StrictMode',
    arquivo: 'src/animacao/NumeroAnimado.jsx',
    de: '      exibido.current = contador.v;\n    };',
    para: '      elemento.textContent = formatar(final);\n      exibido.current = final;\n    };',
    spec: 'testes/animacao.test.jsx',
  },
  {
    descricao: 'foto grande deixa de ser reduzida antes do envio',
    arquivo: 'src/dominio/prepararAnexo.js',
    de: 'const escala = Math.min(1, LADO_MAXIMO / Math.max(imagem.width, imagem.height));',
    para: 'const escala = 1;',
    spec: 'testes/prepararAnexo.test.js',
  },
  {
    descricao: 'foto deixa de ser desvirada pela orientação da câmera',
    arquivo: 'src/dominio/prepararAnexo.js',
    de: "imagem = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });",
    para: 'imagem = await createImageBitmap(arquivo);',
    spec: 'testes/prepararAnexo.test.js',
  },
  {
    descricao: 'recodificar que sai maior passa a valer mesmo assim',
    arquivo: 'src/dominio/prepararAnexo.js',
    de: 'if (!blob || blob.size >= arquivo.size) return arquivo;',
    para: 'if (!blob) return arquivo;',
    spec: 'testes/prepararAnexo.test.js',
  },
  {
    descricao: 'PDF acima do limite volta a ser enviado para o servidor recusar',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: 'if (arquivo.size > LIMITE_BYTES) {',
    para: 'if (false) {',
    motor: 'playwright',
    spec: 'e2e/anexos.spec.js',
  },
  {
    descricao: 'trocar o local mantém o equipamento de outro lugar no chamado',
    arquivo: 'src/pages/NovoChamado.jsx',
    de: "if (campo === 'local_id') novo.equipamento_id = '';",
    para: '',
    spec: 'testes/Preventiva.test.jsx',
  },
  {
    descricao: 'plano com equipamento leva junto o local escolhido antes',
    arquivo: 'src/pages/Preventiva.jsx',
    de: 'local_id: plano.equipamento_id ? undefined : numeroOuNada(plano.local_id),',
    para: 'local_id: numeroOuNada(plano.local_id),',
    spec: 'testes/Preventiva.test.jsx',
  },
  {
    descricao: 'data prevista passa por new Date e volta um dia no fuso de Brasília',
    arquivo: 'src/dominio/preventiva.js',
    de: "const [ano, mes, d] = String(dia).slice(0, 10).split('-');\n  return `${d}/${mes}/${ano}`;",
    para: "return new Date(dia).toLocaleDateString('pt-BR');",
    spec: 'testes/Preventiva.test.jsx',
  },
  {
    descricao: 'ficha deixa de apontar o equipamento que quebra demais',
    arquivo: 'src/pages/Equipamento.jsx',
    de: '{totais.corretivos_12_meses >= 3 && (',
    para: '{totais.corretivos_12_meses > 3 && (',
    spec: 'testes/Preventiva.test.jsx',
  },
  {
    descricao: 'login volta a aceitar destino em outro domínio (barra dupla)',
    arquivo: 'src/pages/Login.jsx',
    de: "if (!destino.startsWith('/') || destino.startsWith('//') || destino.includes('\\\\')) return '/';",
    para: "if (!destino.startsWith('/') || destino.includes('\\\\')) return '/';",
    spec: 'testes/destinoSeguro.test.js',
  },
  {
    descricao: 'falha de rede volta a cair na mensagem genérica',
    arquivo: 'src/api/client.js',
    de: "if (!error.response && error.code !== 'ERR_CANCELED') {",
    para: 'if (false) {',
    spec: 'testes/client.test.js',
  },
  {
    descricao: 'QR passa a codificar o endereço sem o código do equipamento escapado',
    arquivo: 'src/dominio/preventiva.js',
    de: '?equipamento=${encodeURIComponent(equipamento.codigo)}',
    para: '?equipamento=${equipamento.id}',
    spec: 'testes/CodigoQR.test.jsx',
  },
  {
    descricao: 'service worker deixa de guardar a fila para uso sem conexão',
    arquivo: 'public/sw.js',
    de: "      const cache = await caches.open(DADOS);\n      await cache.put(requisicao, resposta.clone());",
    para: '',
    motor: 'playwright',
    spec: 'e2e/pwa.spec.js',
  },
  {
    descricao: 'sair deixa a fila guardada para o próximo a usar o aparelho',
    arquivo: 'src/context/AuthContext.jsx',
    de: "  const logout = useCallback(() => {\n    limparDadosOffline();",
    para: '  const logout = useCallback(() => {',
    motor: 'playwright',
    spec: 'e2e/pwa.spec.js',
  },
  {
    descricao: 'quem sai deixa o próprio endereço para o próximo que entrar no aparelho',
    arquivo: 'src/components/RotaProtegida.jsx',
    de: '    if (saiu) return <Navigate to="/login" replace />;\n',
    para: '',
    spec: 'testes/RotaProtegida.test.jsx',
  },
  {
    descricao: 'login volta a esquecer o endereço pedido (QR Code cai no início)',
    arquivo: 'src/components/RotaProtegida.jsx',
    de: '<Navigate to="/login" replace state={{ de: `${local.pathname}${local.search}` }} />',
    para: '<Navigate to="/login" replace />',
    motor: 'playwright',
    spec: 'e2e/pwa.spec.js',
  },
  {
    descricao: 'aviso do agendador passa a alarmar também com tudo em dia',
    arquivo: 'src/components/AvisoDoAgendador.jsx',
    de: 'setProblemas((data?.tarefas ?? []).filter((t) => FRASES[t.situacao]));',
    para: 'setProblemas(data?.tarefas ?? []);',
    spec: 'testes/Operacao.test.jsx',
  },
  {
    descricao: 'expediente salvo leva junto os dias desmarcados',
    arquivo: 'src/components/ExpedienteEFeriados.jsx',
    de: '            .filter((d) => d.ativo)\n',
    para: '',
    spec: 'testes/Operacao.test.jsx',
  },
  {
    descricao: 'abas de cadastros voltam a alargar a página no celular',
    arquivo: 'src/pages/Cadastros.jsx',
    de: '<div className="flex gap-2 border-b overflow-x-auto">',
    para: '<div className="flex gap-2 border-b">',
    motor: 'playwright',
    spec: 'e2e/layout.spec.js',
  },
  {
    descricao: 'sem matchMedia (jsdom) o sistema passa a tentar animar',
    arquivo: 'src/animacao/movimento.js',
    de: "if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;",
    para: "if (typeof window === 'undefined') return true;",
    spec: 'testes/animacao.test.jsx',
  },
  {
    descricao: 'entrada de página deixa o frame final aplicado (fixed preso ao envoltório)',
    arquivo: 'tailwind.config.js',
    de: "'pagina-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) backwards'",
    para: "'pagina-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) both'",
    motor: 'playwright',
    spec: 'e2e/animacao.spec.js',
  },
  {
    descricao: 'barra do relatório perde a transição de largura',
    arquivo: 'src/pages/Relatorios.jsx',
    de: ' transition-[width] duration-700 ease-out',
    para: '',
    motor: 'playwright',
    spec: 'e2e/animacao.spec.js',
  },
  {
    descricao: 'lista deixa de deslizar os cartões que continuam (FLIP)',
    arquivo: 'src/animacao/useListaAnimada.js',
    de: "return a && (Math.abs(a.x - n.x) > 1 || Math.abs(a.y - n.y) > 1);",
    para: 'return false;',
    spec: 'testes/listaAnimada.test.jsx',
  },
  {
    descricao: 'o esqueleto de carregamento apaga o retrato anterior da lista',
    arquivo: 'src/animacao/useListaAnimada.js',
    de: "    if (itens.length === 0) return undefined;",
    para: "    if (itens.length === 0) {\n      anteriores.current = new Map();\n      return undefined;\n    }",
    spec: 'testes/listaAnimada.test.jsx',
  },
  {
    descricao: 'painel de resumo deixa a página atrás rolar',
    arquivo: 'src/components/chamados/PainelDeResumo.jsx',
    de: "    document.body.style.overflow = 'hidden';",
    para: '    document.body.style.overflow = anterior;',
    spec: 'testes/PainelDeResumo.test.jsx',
  },
  {
    descricao: 'painel de resumo deixa de ir para o body (portal vai para #root)',
    arquivo: 'src/components/chamados/PainelDeResumo.jsx',
    de: '    </div>,\n    document.body\n  );',
    para: "    </div>,\n    document.getElementById('root')\n  );",
    motor: 'playwright',
    spec: 'e2e/animacao.spec.js',
  },
  {
    descricao: 'gráfico ignora a margem do eixo ao achar o dia sob o mouse',
    arquivo: 'src/components/ui/GraficoDeLinhas.jsx',
    de: 'evento.clientX - medidas.left - MARGEM.esquerda',
    para: 'evento.clientX - medidas.left',
    spec: 'testes/GraficoDeLinhas.test.jsx',
  },
  {
    descricao: 'gráfico deixa de revelar a linha da esquerda para a direita',
    arquivo: 'src/components/ui/GraficoDeLinhas.jsx',
    de: 'if (!retangulo || reduzMovimento() || n === 0) return undefined;',
    para: 'return undefined;',
    spec: 'testes/GraficoDeLinhas.test.jsx',
  },
  {
    descricao: 'escala vertical deixa de cobrir o maior valor (arredonda para baixo)',
    arquivo: 'src/components/ui/GraficoDeLinhas.jsx',
    de: 'const topo = Math.ceil(alvo / passo) * passo;',
    para: 'const topo = Math.floor(alvo / passo) * passo;',
    spec: 'testes/GraficoDeLinhas.test.jsx',
  },
  {
    descricao: 'gráfico perde o min-w-0 e alarga a página inteira no celular',
    arquivo: 'src/components/ui/GraficoDeLinhas.jsx',
    de: 'className="relative min-w-0 touch-pan-y select-none rounded"',
    para: 'className="relative touch-pan-y select-none rounded"',
    motor: 'playwright',
    spec: 'e2e/animacao.spec.js',
  },
  {
    descricao: 'cliente da API deixa de mandar o cabeçalho que a trava de CSRF exige',
    arquivo: 'src/api/client.js',
    de: "headers: { 'X-Conserva': '1' },",
    para: 'headers: {},',
    spec: 'testes/client.test.js',
  },
  {
    descricao: 'login volta a guardar o token no localStorage',
    arquivo: 'src/context/AuthContext.jsx',
    de: '    localStorage.setItem(CHAVE_USUARIO, JSON.stringify(dados.usuario));',
    para: "    localStorage.setItem('smp_token', dados.token);\n    localStorage.setItem(CHAVE_USUARIO, JSON.stringify(dados.usuario));",
    spec: 'testes/DuasEtapas.test.jsx',
  },
  {
    descricao: 'token de versão anterior fica esquecido no aparelho',
    arquivo: 'src/context/AuthContext.jsx',
    de: "    localStorage.removeItem('smp_token');",
    para: '',
    spec: 'testes/DuasEtapas.test.jsx',
  },
  {
    descricao: 'login ignora o pedido de segundo fator',
    arquivo: 'src/context/AuthContext.jsx',
    de: '      if (data.requer_2fa) return { requer2fa: true, desafio: data.desafio };',
    para: '',
    spec: 'testes/DuasEtapas.test.jsx',
  },
  {
    descricao: 'sair deixa de pedir ao servidor que apague o cookie',
    arquivo: 'src/context/AuthContext.jsx',
    de: "    api.post('/auth/sair').catch(() => {});",
    para: '',
    spec: 'testes/DuasEtapas.test.jsx',
  },
  {
    descricao: 'desafio vencido deixa a tela presa pedindo código',
    arquivo: 'src/pages/Login.jsx',
    de: "      if (corpo?.codigo === 'DESAFIO_INVALIDO') {\n        setDesafio(null);",
    para: "      if (corpo?.codigo === 'DESAFIO_INVALIDO') {",
    spec: 'testes/DuasEtapas.test.jsx',
  },
  {
    descricao: '"sair de todos" deixa esta sessão aberta na tela',
    arquivo: 'src/pages/MinhaConta.jsx',
    de: '    if (r) logout();',
    para: '',
    spec: 'testes/DuasEtapas.test.jsx',
  },
  {
    descricao: 'ligar o 2FA deixa de mostrar os códigos de recuperação',
    arquivo: 'src/pages/MinhaConta.jsx',
    de: '      setCodigos(r.data.codigos_recuperacao);\n      setAviso(\'Verificação em duas etapas ligada.',
    para: "      setAviso('Verificação em duas etapas ligada.",
    spec: 'testes/DuasEtapas.test.jsx',
  },
  {
    descricao: 'distribuição: trocar a unidade deixa o bloco da unidade anterior',
    arquivo: 'src/components/RegrasDeDistribuicao.jsx',
    de: "      if (campo === 'unidade') proxima.bloco = '';\n",
    para: '',
    spec: 'testes/RegrasDeDistribuicao.test.jsx',
  },
  {
    descricao: 'distribuição: técnico inativo aparece como plantonista',
    arquivo: 'src/components/RegrasDeDistribuicao.jsx',
    de: 'setMembros(data.equipe.tecnicos.filter((t) => t.ativo))',
    para: 'setMembros(data.equipe.tecnicos)',
    spec: 'testes/RegrasDeDistribuicao.test.jsx',
  },
  {
    descricao: 'distribuição: campo de alcance vazio vai para a API como texto vazio',
    arquivo: 'src/components/RegrasDeDistribuicao.jsx',
    de: '    if (nova.unidade) corpo.unidade = nova.unidade;',
    para: '    corpo.unidade = nova.unidade;',
    spec: 'testes/RegrasDeDistribuicao.test.jsx',
  },
  {
    descricao: 'preventiva: "Gerar agora" volta a aceitar clique enquanto o pedido anda',
    arquivo: 'src/pages/Preventiva.jsx',
    de: '                            carregando={gerando === p.id}\n                            disabled={gerando !== null}\n',
    para: '',
    spec: 'testes/Preventiva.test.jsx',
  },
  {
    descricao: 'preventiva: antecipar fora da janela deixa de perguntar',
    arquivo: 'src/pages/Preventiva.jsx',
    de: '    if (hojeLocal() < aberturaDaJanela(p)) setAntecipar(p);\n    else gerar(p);',
    para: '    gerar(p);',
    spec: 'testes/Preventiva.test.jsx',
  },
  {
    descricao: 'preventiva: dentro da janela passa a perguntar à toa',
    arquivo: 'src/pages/Preventiva.jsx',
    de: 'if (hojeLocal() < aberturaDaJanela(p))',
    para: 'if (hojeLocal() <= aberturaDaJanela(p) || true)',
    spec: 'testes/Preventiva.test.jsx',
  },
  {
    descricao: 'aprovação: recusar apaga o pedido sem perguntar',
    arquivo: 'src/components/CadastrosPendentes.jsx',
    de: 'onClick={() => setARecusar([p])}',
    para: "onClick={() => decidir('recusar', [p.id])}",
    spec: 'testes/CadastrosPendentes.test.jsx',
  },
  {
    descricao: 'aprovação: cadastro pendente é mandado ao login como se tivesse entrado',
    arquivo: 'src/pages/Cadastro.jsx',
    de: 'setRecebido({ aguardando: Boolean(resposta?.aguardando_aprovacao) });',
    para: 'setRecebido({ aguardando: false });',
    spec: 'testes/CadastrosPendentes.test.jsx',
  },
  {
    descricao: 'aprovação: o painel da gestão passa a ler (e oferecer) a exigência',
    arquivo: 'src/components/CadastrosPendentes.jsx',
    de: '    if (comConfiguracao) {\n      api',
    para: '    if (true) {\n      api',
    spec: 'testes/CadastrosPendentes.test.jsx',
  },
  {
    descricao: 'google: conta que espera aprovação entra como se tivesse sido aprovada',
    arquivo: 'src/pages/Login.jsx',
    de: '      if (resultado?.aguardandoAprovacao) {',
    para: '      if (false) {',
    spec: 'testes/LoginGoogle.test.jsx',
  },
  {
    descricao: 'google: o botão aparece (e o script do Google carrega) sem o ID do cliente',
    arquivo: 'src/components/BotaoGoogle.jsx',
    de: '    if (!clienteId) return undefined;',
    para: '',
    spec: 'testes/LoginGoogle.test.jsx',
  },
  {
    descricao: 'google: duas etapas pelo Google viram sessão sem o código',
    arquivo: 'src/context/AuthContext.jsx',
    de: "      if (data.requer_2fa) return { requer2fa: true, desafio: data.desafio };\n      return iniciarSessao(data);\n    },\n    [iniciarSessao]\n  );\n\n  // Devolve",
    para: "      return iniciarSessao(data);\n    },\n    [iniciarSessao]\n  );\n\n  // Devolve",
    spec: 'testes/LoginGoogle.test.jsx',
  },
  {
    descricao: 'google: 401 no login pelo Google anuncia sessão expirada',
    arquivo: 'src/api/client.js',
    de: " || url.includes('/auth/google')",
    para: '',
    spec: 'testes/client.test.js',
  },
  {
    descricao: 'exigência de 2FA: a rota protegida deixa abrir qualquer tela',
    arquivo: 'src/components/RotaProtegida.jsx',
    de: "if (usuario.dois_fatores_pendente && local.pathname !== '/conta') {",
    para: 'if (false) {',
    spec: 'testes/ExigenciaDoisFatores.test.jsx',
  },
  {
    descricao: 'exigência de 2FA: o 403 da API deixa de avisar a tela',
    arquivo: 'src/api/client.js',
    de: "error.response.data?.erro?.codigo === 'DOIS_FATORES_OBRIGATORIO'",
    para: 'false',
    spec: 'testes/client.test.js',
  },
  {
    descricao: 'exigência de 2FA: ligar a verificação não tira a restrição',
    arquivo: 'src/pages/MinhaConta.jsx',
    de: '      concluirDoisFatores();\n',
    para: '',
    spec: 'testes/ExigenciaDoisFatores.test.jsx',
  },
  {
    descricao: 'exigência de 2FA: conta desativada entra na lista de quem falta',
    arquivo: 'src/components/ExigenciaDoisFatores.jsx',
    de: '&& u.ativo && !u.anonimizado_em',
    para: '&& !u.anonimizado_em',
    spec: 'testes/ExigenciaDoisFatores.test.jsx',
  },
  {
    descricao: 'UX: o botão do Google deixa de acompanhar o espaço (sem ResizeObserver)',
    arquivo: 'src/components/BotaoGoogle.jsx',
    de: "if (typeof ResizeObserver !== 'undefined') {",
    para: 'if (false) {',
    spec: 'testes/LoginGoogle.test.jsx',
  },
  {
    descricao: 'UX: o botão do Google redesenha a cada aviso, sem esperar a medida assentar',
    arquivo: 'src/components/BotaoGoogle.jsx',
    de: 'espera = setTimeout(desenhar, ESPERA_MS);',
    para: 'desenhar();',
    spec: 'testes/LoginGoogle.test.jsx',
  },
  {
    descricao: 'UX: o botão do Google redesenha mesmo sem a largura ter mudado',
    arquivo: 'src/components/BotaoGoogle.jsx',
    de: 'if (largura === ultimaLargura) return;',
    para: '',
    spec: 'testes/LoginGoogle.test.jsx',
  },
  {
    descricao: 'UX: o botão do Google empilha o novo ao lado do antigo',
    arquivo: 'src/components/BotaoGoogle.jsx',
    de: 'lugar.current.replaceChildren();',
    para: '',
    spec: 'testes/LoginGoogle.test.jsx',
  },
  {
    descricao: 'UX: o botão do Google deixa o observador ligado depois de sair da tela',
    arquivo: 'src/components/BotaoGoogle.jsx',
    de: 'observador?.disconnect();',
    para: '',
    spec: 'testes/LoginGoogle.test.jsx',
  },
  {
    descricao: 'UX: o formulário do login volta a esticar com o botão do Google (grade sem min-w-0)',
    arquivo: 'src/components/BotaoGoogle.jsx',
    de: '<div className="grid min-w-0 gap-3">',
    para: '<div className="grid gap-3">',
    spec: 'testes/LoginGoogle.test.jsx',
  },
  {
    descricao: 'UX: o espaço do botão do Google volta a poder esticar a coluna',
    arquivo: 'src/components/BotaoGoogle.jsx',
    de: 'className="flex min-h-[44px] min-w-0 justify-center overflow-hidden"',
    para: 'className="flex min-h-[44px] justify-center"',
    // Quem estica a coluna é a medida mínima de um item de grade: só o
    // navegador mede isso, com o celular girando de verdade.
    motor: 'playwright',
    spec: 'e2e/google.spec.js',
  },
  {
    descricao: 'UX: abrir os passos da ativação deixa o foco no corpo da página',
    arquivo: 'src/pages/MinhaConta.jsx',
    de: 'if (cadastro) blocoAtivacao.current?.focus();',
    para: '',
    spec: 'testes/ExigenciaDoisFatores.test.jsx',
  },
  {
    descricao: 'UX: os códigos de recuperação aparecem sem levar o foco até eles',
    arquivo: 'src/pages/MinhaConta.jsx',
    de: 'if (codigos) blocoCodigos.current?.focus();',
    para: '',
    spec: 'testes/ExigenciaDoisFatores.test.jsx',
  },
  {
    descricao: 'UX: cancelar a ativação não devolve o foco ao botão que a abriu',
    arquivo: 'src/pages/MinhaConta.jsx',
    de: 'voltarAoBotao.current = true;',
    para: 'voltarAoBotao.current = false;',
    spec: 'testes/ExigenciaDoisFatores.test.jsx',
  },
  {
    descricao: 'UX: "Copiar chave" copia a chave com os espaços de leitura',
    arquivo: 'src/pages/MinhaConta.jsx',
    de: 'await navigator.clipboard.writeText(cadastro.segredo);',
    para: "await navigator.clipboard.writeText(cadastro.segredo.replace(/(.{4})/g, '$1 '));",
    spec: 'testes/ExigenciaDoisFatores.test.jsx',
  },
  {
    descricao: 'UX: copiar a chave diz "copiada" mesmo quando a área de transferência recusa',
    arquivo: 'src/pages/MinhaConta.jsx',
    de: "setCopia('falhou');",
    para: "setCopia('copiada');",
    spec: 'testes/ExigenciaDoisFatores.test.jsx',
  },
  {
    descricao: 'UX: o atalho para o aplicativo autenticador não leva ao endereço otpauth',
    arquivo: 'src/pages/MinhaConta.jsx',
    de: 'href={cadastro.endereco}',
    para: 'href="#"',
    spec: 'testes/ExigenciaDoisFatores.test.jsx',
  },
  {
    descricao: 'UX: o atalho para o aplicativo aparece também no computador',
    arquivo: 'src/pages/MinhaConta.jsx',
    de: 'className="mt-1 hidden [@media(pointer:coarse)]:block"',
    para: 'className="mt-1 block"',
    // Depende de `@media (pointer: coarse)`, que o jsdom não avalia.
    motor: 'playwright',
    spec: 'e2e/google.spec.js',
  },
  {
    descricao: 'UX: a chave sai de uma peça só, sem grupos de 4 para ler e digitar',
    arquivo: 'src/pages/MinhaConta.jsx',
    de: "{cadastro.segredo.replace(/(.{4})/g, '$1 ').trim()}",
    para: '{cadastro.segredo}',
    spec: 'testes/DuasEtapas.test.jsx',
  },
  {
    descricao: 'UX: conta restrita lê "Recomendada" onde a administração já exige',
    arquivo: 'src/pages/MinhaConta.jsx',
    de: '{usuario.dois_fatores_pendente\n                ?',
    para: '{false\n                ?',
    spec: 'testes/ExigenciaDoisFatores.test.jsx',
  },
  {
    descricao: 'UX: conta restrita volta a mostrar o sino (que só dá erro)',
    arquivo: 'src/components/Layout.jsx',
    de: '{!restrito && <Avisos />}',
    para: '{<Avisos />}',
    spec: 'testes/ExigenciaDoisFatores.test.jsx',
  },
  {
    descricao: 'EPI: a caixa de confirmação deixa de ser obrigatória',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: '                    required\n                    checked={epiConfirmado}',
    para: '                    checked={epiConfirmado}',
    spec: 'testes/ChamadoDetalhe.test.jsx',
  },
  {
    descricao: 'EPI: a conclusão segue sem mandar a confirmação',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: '                  epi_confirmado: epiConfirmado,\n',
    para: '',
    spec: 'testes/ChamadoDetalhe.test.jsx',
  },
  {
    descricao: 'EPI: a caixa herda a marcação da vez anterior',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: '      setEpiConfirmado(false);\n      setConcluindo(true);',
    para: '      setConcluindo(true);',
    spec: 'testes/ChamadoDetalhe.test.jsx',
  },
  {
    descricao: 'EPI: a caixa perde a explicação lida pelo leitor de tela',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: 'aria-describedby="epi-ajuda"',
    para: '',
    spec: 'testes/ChamadoDetalhe.test.jsx',
  },
  {
    descricao: 'EPI: o registro do atendimento esconde quando foi confirmado',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: '{chamado.epi_confirmado_em && (',
    para: '{false && (',
    spec: 'testes/ChamadoDetalhe.test.jsx',
  },
  {
    descricao: 'EPI: chamado antigo ganha uma confirmação que nunca existiu',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: '{chamado.epi_confirmado_em && (',
    para: '{chamado.data_conclusao && (',
    spec: 'testes/ChamadoDetalhe.test.jsx',
  },
  {
    descricao: 'EPI: o rótulo da caixa volta a ser menor que o alvo mínimo de 24 px',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: 'flex items-start gap-3 py-1 font-medium text-tinta',
    para: 'flex items-start gap-3 font-medium text-tinta',
    // Altura de elemento só o navegador mede.
    motor: 'playwright',
    spec: 'e2e/epi.spec.js',
  },
  {
    descricao: 'LGPD: o aviso do cadastro volta a abrir na mesma aba (e a pessoa perde o formulário)',
    arquivo: 'src/pages/Cadastro.jsx',
    de: 'href="/privacidade"\n            target="_blank"',
    para: 'href="/privacidade"',
    spec: 'testes/AvisoDePrivacidade.test.jsx',
  },
  {
    descricao: 'LGPD: o aviso abre em outra aba sem `noopener`',
    arquivo: 'src/pages/Cadastro.jsx',
    de: 'rel="noopener noreferrer"',
    para: 'rel="noreferrer"',
    spec: 'testes/AvisoDePrivacidade.test.jsx',
  },
  {
    descricao: 'LGPD: o link do cadastro deixa de levar ao aviso',
    arquivo: 'src/pages/Cadastro.jsx',
    de: 'href="/privacidade"',
    para: 'href="#"',
    spec: 'testes/AvisoDePrivacidade.test.jsx',
  },
  {
    descricao: 'LGPD: o cadastro deixa de dizer o que será guardado',
    arquivo: 'src/pages/Cadastro.jsx',
    de: 'Guardamos seu nome, seu e-mail e o que você escrever nos chamados.',
    para: 'Guardamos seus dados.',
    spec: 'testes/AvisoDePrivacidade.test.jsx',
  },
  {
    descricao: 'LGPD: a tela de entrada deixa de apontar o aviso (quem cria a conta pelo Google não o veria)',
    arquivo: 'src/pages/Login.jsx',
    de: 'href="/privacidade"',
    para: 'href="#"',
    spec: 'testes/AvisoDePrivacidade.test.jsx',
  },
  {
    descricao: 'LGPD: a conta deixa de apontar o aviso',
    arquivo: 'src/pages/MinhaConta.jsx',
    de: 'href="/privacidade"',
    para: 'href="#"',
    spec: 'testes/AvisoDePrivacidade.test.jsx',
  },
  {
    descricao: 'LGPD: o aviso passa a prometer que apaga contas e chamados sozinho',
    arquivo: 'src/pages/Privacidade.jsx',
    de: 'mas o sistema ainda não faz isso sozinho.',
    para: 'e o sistema faz isso sozinho.',
    spec: 'testes/Privacidade.test.jsx',
  },
  {
    descricao: 'LGPD: o aviso deixa de dizer onde os servidores que executam o sistema ficam',
    arquivo: 'src/pages/Privacidade.jsx',
    de: 'servidores que executam o sistema também ficam em São Paulo',
    para: 'servidores que executam o sistema ficam em local não informado',
    spec: 'testes/Privacidade.test.jsx',
  },
  {
    descricao: 'LGPD: o backend volta à região padrão da Vercel (EUA) e o aviso segue dizendo São Paulo',
    arquivo: '../backend/vercel.json',
    de: '"regions": ["gru1"]',
    para: '"regions": ["iad1"]',
    spec: 'testes/Privacidade.test.jsx',
  },
  {
    descricao: 'LGPD: o aviso passa a falar como se a instituição controladora já existisse',
    arquivo: 'src/pages/Privacidade.jsx',
    de: 'ainda não foi formalizada',
    para: 'é a instituição de ensino',
    spec: 'testes/Privacidade.test.jsx',
  },
  {
    descricao: 'LGPD: o aviso cita base legal antes de a instituição ser definida',
    arquivo: 'src/pages/Privacidade.jsx',
    de: 'O acesso é por perfil,',
    para: 'Com base no legítimo interesse, o acesso é por perfil,',
    spec: 'testes/Privacidade.test.jsx',
  },
  {
    descricao: 'LGPD: o aviso descreve a remoção como exclusão, e não como anonimização',
    arquivo: 'src/pages/Privacidade.jsx',
    de: 'seu nome vira “Usuário removido”',
    para: 'seu nome é apagado',
    spec: 'testes/Privacidade.test.jsx',
  },
  {
    descricao: 'LGPD: o aviso esquece o IP de quem errou a senha',
    arquivo: 'src/pages/Privacidade.jsx',
    de: 'inclusive de quem errou a senha, ',
    para: '',
    spec: 'testes/Privacidade.test.jsx',
  },
  {
    descricao: 'LGPD: a rota pública do aviso some',
    arquivo: 'src/App.jsx',
    de: '          <Route path="/privacidade" element={<Privacidade />} />\n',
    para: '',
    motor: 'playwright',
    spec: 'e2e/privacidade.spec.js',
  },
  {
    descricao: 'LGPD: os links soltos do aviso voltam a ter menos de 24px de altura',
    arquivo: 'src/pages/Privacidade.jsx',
    de: 'const LINK_SOLTO = `${LINK} alvo-toque inline-block py-1`;',
    para: 'const LINK_SOLTO = LINK;',
    motor: 'playwright',
    spec: 'e2e/privacidade.spec.js',
  },
  // Achados menores da revisão de UX (cartão da exigência, Login, Minha conta).
  {
    descricao: 'UX restante: a lista de contas sem verificação deixa de parar em cinco',
    arquivo: 'src/components/ExigenciaDoisFatores.jsx',
    de: 'const LIMITE_DA_LISTA = 5;',
    para: 'const LIMITE_DA_LISTA = 500;',
    spec: 'testes/ExigenciaDoisFatores.test.jsx',
  },
  {
    descricao: 'UX restante: a lista deixa de mostrar o e-mail (homônimos ficam iguais)',
    arquivo: 'src/components/ExigenciaDoisFatores.jsx',
    de: '{u.email && <span className="break-all"> ({u.email})</span>}',
    para: '{null}',
    spec: 'testes/ExigenciaDoisFatores.test.jsx',
  },
  {
    descricao: 'UX restante: a caixa deixa de dizer quantas contas ela restringe ao ligar',
    arquivo: 'src/components/ExigenciaDoisFatores.jsx',
    de: 'if (faltam > 0 && exige === false) {',
    para: 'if (false) {',
    spec: 'testes/ExigenciaDoisFatores.test.jsx',
  },
  {
    descricao: 'UX restante: com a exigência ligada, a caixa deixa de dizer quantas contas estão restritas',
    arquivo: 'src/components/ExigenciaDoisFatores.jsx',
    de: '} else if (faltam > 0 && exige === true) {',
    para: '} else if (false) {',
    spec: 'testes/ExigenciaDoisFatores.test.jsx',
  },
  {
    descricao: 'UX restante: toda recusa do servidor passa a mandar para Minha conta',
    arquivo: 'src/components/ExigenciaDoisFatores.jsx',
    de: "setErroPedeMinhaConta(corpo?.codigo === 'SEM_2FA_PROPRIO');",
    para: 'setErroPedeMinhaConta(true);',
    spec: 'testes/ExigenciaDoisFatores.test.jsx',
  },
  {
    descricao: 'UX restante: a recusa por falta da própria verificação deixa de levar a Minha conta',
    arquivo: 'src/components/ExigenciaDoisFatores.jsx',
    de: "setErroPedeMinhaConta(corpo?.codigo === 'SEM_2FA_PROPRIO');",
    para: 'setErroPedeMinhaConta(false);',
    spec: 'testes/ExigenciaDoisFatores.test.jsx',
  },
  {
    descricao: 'UX restante: a ajuda de quem não tem senha volta a aparecer aberta para todos',
    arquivo: 'src/pages/MinhaConta.jsx',
    de: '<details className="text-xs text-tinta-2">',
    para: '<details open className="text-xs text-tinta-2">',
    spec: 'testes/ExigenciaDoisFatores.test.jsx',
  },
  {
    descricao: 'UX restante: o passo do código deixa de mostrar a conta (senha)',
    arquivo: 'src/pages/Login.jsx',
    de: "setContaDoDesafio(resultado.email || email);",
    para: "setContaDoDesafio('');",
    spec: 'testes/DuasEtapas.test.jsx',
  },
  {
    descricao: 'UX restante: o passo do código deixa de usar o e-mail digitado quando o servidor não manda',
    arquivo: 'src/pages/Login.jsx',
    de: "setContaDoDesafio(resultado.email || email);",
    para: 'setContaDoDesafio(resultado.email);',
    spec: 'testes/DuasEtapas.test.jsx',
  },
  {
    descricao: 'UX restante: o passo do código deixa de mostrar a conta (Google, onde ninguém digitou o e-mail)',
    arquivo: 'src/pages/Login.jsx',
    de: "setContaDoDesafio(resultado.email || '');",
    para: "setContaDoDesafio('');",
    spec: 'testes/LoginGoogle.test.jsx',
  },
  {
    descricao: 'UX restante: o cadastro pendente pelo Google volta a ser um aviso sobre o formulário',
    arquivo: 'src/pages/Login.jsx',
    de: 'setPedidoEnviado(true);',
    para: 'setPedidoEnviado(false);',
    spec: 'testes/LoginGoogle.test.jsx',
  },
  {
    descricao: 'UX restante: a tela "Pedido enviado" não leva o foco ao título',
    arquivo: 'src/components/PedidoEnviado.jsx',
    de: 'titulo.current?.focus();',
    para: '',
    spec: 'testes/LoginGoogle.test.jsx',
  },
  {
    descricao: 'UX restante: o Login perde a área principal',
    arquivo: 'src/pages/Login.jsx',
    de: '<main className="min-h-screen bg-fundo flex items-center justify-center px-4 py-8">',
    para: '<main role="presentation" className="min-h-screen bg-fundo flex items-center justify-center px-4 py-8">',
    spec: 'testes/AreaPrincipal.test.jsx',
  },
  {
    descricao: 'UX restante: o cadastro perde a área principal',
    arquivo: 'src/pages/Cadastro.jsx',
    de: '<main className="min-h-screen bg-fundo flex items-center justify-center px-4 py-8">',
    para: '<main role="presentation" className="min-h-screen bg-fundo flex items-center justify-center px-4 py-8">',
    spec: 'testes/AreaPrincipal.test.jsx',
  },
  {
    descricao: 'UX restante: recuperar senha perde a área principal',
    arquivo: 'src/pages/RecuperarSenha.jsx',
    de: '<main className="min-h-screen bg-fundo flex items-center justify-center px-4 py-8">',
    para: '<main role="presentation" className="min-h-screen bg-fundo flex items-center justify-center px-4 py-8">',
    spec: 'testes/AreaPrincipal.test.jsx',
  },
  {
    descricao: 'UX restante: redefinir senha perde a área principal',
    arquivo: 'src/pages/RedefinirSenha.jsx',
    de: '<main className="min-h-screen bg-fundo flex items-center justify-center px-4 py-8">',
    para: '<main role="presentation" className="min-h-screen bg-fundo flex items-center justify-center px-4 py-8">',
    spec: 'testes/AreaPrincipal.test.jsx',
  },
  {
    descricao: 'UX restante: o link da conta no cabeçalho volta a ter 20px de altura',
    arquivo: 'src/components/Layout.jsx',
    de: 'className="alvo-toque min-w-0 rounded py-1 hover:underline"',
    para: 'className="alvo-toque min-w-0 rounded hover:underline"',
    motor: 'playwright',
    spec: 'e2e/layout.spec.js',
  },
  // Alerta de crítico sem atendimento: o que a gestão vê.
  {
    descricao: 'alerta crítico: a faixa passa a aparecer mesmo sem nenhum chamado parado',
    arquivo: 'src/components/AlertaDeCriticos.jsx',
    de: 'if (!alerta.total) return null;',
    para: 'if (false) return null;',
    spec: 'testes/AlertaDeCriticos.test.jsx',
  },
  {
    descricao: 'alerta crítico: a faixa deixa de pedir só os sinalizados',
    arquivo: 'src/components/AlertaDeCriticos.jsx',
    de: "params: { sem_atendimento: 'true', limite: 1 },",
    para: 'params: { limite: 1 },',
    spec: 'testes/AlertaDeCriticos.test.jsx',
  },
  {
    descricao: 'alerta crítico: a faixa repete o limite no navegador em vez de ler o do servidor',
    arquivo: 'src/components/AlertaDeCriticos.jsx',
    de: 'minutos: data.atendimento_critico_minutos',
    para: 'minutos: 15',
    spec: 'testes/AlertaDeCriticos.test.jsx',
  },
  {
    descricao: 'alerta crítico: a faixa deixa de se atualizar a cada minuto',
    arquivo: 'src/components/AlertaDeCriticos.jsx',
    de: 'const id = setInterval(consultar, INTERVALO);',
    para: 'const id = setInterval(() => {}, INTERVALO);',
    spec: 'testes/AlertaDeCriticos.test.jsx',
  },
  {
    descricao: 'alerta crítico: a faixa deixa de se atualizar ao navegar',
    arquivo: 'src/components/AlertaDeCriticos.jsx',
    de: '  }, [pathname]);',
    para: '  }, []);',
    spec: 'testes/AlertaDeCriticos.test.jsx',
  },
  {
    descricao: 'alerta crítico: a faixa passa a apagar o número quando a consulta falha',
    arquivo: 'src/components/AlertaDeCriticos.jsx',
    de: '        // Falha de rede ou de servidor: fica o último número conhecido.',
    para: '        setAlerta({ total: 0, minutos: null });',
    spec: 'testes/AlertaDeCriticos.test.jsx',
  },
  {
    descricao: 'alerta crítico: a faixa passa a aceitar a resposta guardada pelo service worker',
    arquivo: 'src/components/AlertaDeCriticos.jsx',
    de: "if (!vivo || headers?.['x-servido-do-cache']) return;",
    para: 'if (!vivo) return;',
    spec: 'testes/AlertaDeCriticos.test.jsx',
  },
  {
    descricao: 'alerta crítico: a faixa consulta com a aba escondida',
    arquivo: 'src/components/AlertaDeCriticos.jsx',
    de: 'if (document.hidden) return;',
    para: '',
    spec: 'testes/AlertaDeCriticos.test.jsx',
  },
  {
    descricao: 'alerta crítico: o link da faixa deixa de abrir o painel filtrado',
    arquivo: 'src/components/AlertaDeCriticos.jsx',
    de: 'to="/?recorte=criticos"',
    para: 'to="/"',
    spec: 'testes/AlertaDeCriticos.test.jsx',
  },
  {
    descricao: 'alerta crítico: a faixa chega a quem não é da gestão',
    arquivo: 'src/components/Layout.jsx',
    de: '{podeVerRelatorios && <AlertaDeCriticos />}',
    para: '{<AlertaDeCriticos />}',
    spec: 'testes/AlertaDeCriticos.test.jsx',
  },
  {
    descricao: 'alerta crítico: o selo aparece nas telas de quem pediu e de quem executa',
    arquivo: 'src/components/chamados/CartaoDeChamado.jsx',
    de: '{alertarSemAtendimento && chamado.sem_atendimento_critico && (',
    para: '{chamado.sem_atendimento_critico && (',
    spec: 'testes/AlertaDeCriticos.test.jsx',
  },
  {
    descricao: 'alerta crítico: o selo aparece em chamado que o servidor não sinalizou',
    arquivo: 'src/components/chamados/CartaoDeChamado.jsx',
    de: '{alertarSemAtendimento && chamado.sem_atendimento_critico && (',
    para: '{alertarSemAtendimento && (',
    spec: 'testes/AlertaDeCriticos.test.jsx',
  },
  {
    descricao: 'alerta crítico: o painel deixa de entregar o selo à gestão',
    arquivo: 'src/pages/Dashboard.jsx',
    de: '<CartaoDeChamado key={c.id} chamado={c} mostrarPrazo alertarSemAtendimento />',
    para: '<CartaoDeChamado key={c.id} chamado={c} mostrarPrazo />',
    spec: 'testes/AlertaDeCriticos.test.jsx',
  },
  {
    descricao: 'alerta crítico: o painel deixa de pedir o recorte ao servidor',
    arquivo: 'src/pages/Dashboard.jsx',
    de: "...(semAtendimento ? { sem_atendimento: 'true' } : {}),",
    para: '',
    spec: 'testes/AlertaDeCriticos.test.jsx',
  },
  {
    descricao: 'alerta crítico: o painel ignora o ?recorte=criticos da faixa',
    arquivo: 'src/pages/Dashboard.jsx',
    de: "if (new URLSearchParams(local.search).get('recorte') !== 'criticos') return;",
    para: 'return;',
    spec: 'testes/AlertaDeCriticos.test.jsx',
  },
  {
    descricao: 'alerta crítico: "Limpar filtros" deixa o recorte de críticos ligado',
    arquivo: 'src/pages/Dashboard.jsx',
    de: '    setSemTecnico(false);\n    setSemAtendimento(false);\n    setPagina(1);\n  }\n\n  // Clicar num cartão',
    para: '    setSemTecnico(false);\n    setPagina(1);\n  }\n\n  // Clicar num cartão',
    spec: 'testes/AlertaDeCriticos.test.jsx',
  },
  {
    descricao: 'alerta crítico: o detalhe mostra o aviso a quem não pode agir',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: '{podeGerenciar && chamado.sem_atendimento_critico && (',
    para: '{chamado.sem_atendimento_critico && (',
    spec: 'testes/ChamadoDetalhe.test.jsx',
  },
  {
    descricao: 'alerta crítico: o detalhe mostra o aviso mesmo sem o alerta do servidor',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: '{podeGerenciar && chamado.sem_atendimento_critico && (',
    para: '{podeGerenciar && (',
    spec: 'testes/ChamadoDetalhe.test.jsx',
  },
  {
    descricao: 'alerta crítico: o tempo passa de uma hora sem virar horas',
    arquivo: 'src/dominio/atendimento.js',
    de: "if (minutos < 60) return `${minutos} min`;",
    para: "if (minutos < 600000) return `${minutos} min`;",
    spec: 'testes/atendimento.test.js',
  },
  {
    descricao: 'alerta crítico: o tempo deixa de arredondar para baixo',
    arquivo: 'src/dominio/atendimento.js',
    de: 'Math.floor((agora - aberto) / 60_000)',
    para: 'Math.round((agora - aberto) / 60_000)',
    spec: 'testes/atendimento.test.js',
  },
  {
    descricao: 'alerta crítico (navegador): o link da faixa volta a ter 20px de altura',
    arquivo: 'src/components/AlertaDeCriticos.jsx',
    de: 'className="alvo-toque inline-block py-1 font-medium underline underline-offset-2"',
    para: 'className="alvo-toque inline-block font-medium underline underline-offset-2"',
    motor: 'playwright',
    spec: 'e2e/alertaCritico.spec.js',
  },
  {
    descricao: 'alerta crítico (navegador): a faixa não é refeita ao navegar e fica depois da triagem',
    arquivo: 'src/components/AlertaDeCriticos.jsx',
    de: '  }, [pathname]);',
    para: '  }, []);',
    motor: 'playwright',
    spec: 'e2e/alertaCritico.spec.js',
  },
  {
    descricao: 'alerta crítico (navegador): o painel não aplica o recorte vindo da faixa',
    arquivo: 'src/pages/Dashboard.jsx',
    de: "if (new URLSearchParams(local.search).get('recorte') !== 'criticos') return;",
    para: 'return;',
    motor: 'playwright',
    spec: 'e2e/alertaCritico.spec.js',
  },
  {
    descricao: 'demonstração: o semeador deixa de recusar o endereço da produção',
    arquivo: 'video/destino.mjs',
    de: 'if (PRODUCAO.test(api))',
    para: 'if (false)',
    spec: 'testes/semearDestino.test.js',
  },
  {
    descricao: 'demonstração: o semeador aceita API publicada sem https',
    arquivo: 'video/destino.mjs',
    de: "if (!api.startsWith('https://'))",
    para: 'if (false)',
    spec: 'testes/semearDestino.test.js',
  },
  {
    descricao: 'demonstração: o semeador deixa de exigir credencial fora do banco local',
    arquivo: 'video/destino.mjs',
    de: '(nome) => !env[nome] && !local',
    para: '() => false',
    spec: 'testes/semearDestino.test.js',
  },
  {
    descricao: 'demonstração: o semeador herda credencial padrão numa API publicada',
    arquivo: 'video/destino.mjs',
    de: '(local ? padraoLocal : undefined)',
    para: 'padraoLocal',
    spec: 'testes/semearDestino.test.js',
  },
  {
    descricao: 'demonstração: o semeador escreve mesmo sem a API confirmar o banco de demonstração',
    arquivo: 'video/destino.mjs',
    de: 'corpo?.demonstracao !== true',
    para: 'corpo?.demonstracao === false',
    spec: 'testes/semearDestino.test.js',
  },
  {
    descricao: 'demonstração: o site da demonstração passa a falar com a API da produção',
    arquivo: '../demo/frontend/vercel.json',
    de: 'https://conserva-predial-demo-api.vercel.app/:path*',
    para: 'https://manutencao-predial-backend-delta.vercel.app/:path*',
    spec: 'testes/vercelDemonstracao.test.js',
  },
  {
    descricao: 'demonstração: o site da demonstração afrouxa a CSP (frame-ancestors)',
    arquivo: '../demo/frontend/vercel.json',
    de: "frame-ancestors 'none'",
    para: 'frame-ancestors *',
    spec: 'testes/vercelDemonstracao.test.js',
  },
  {
    descricao: 'demonstração: a faixa de demonstração aparece também na produção',
    arquivo: 'src/components/FaixaDeDemonstracao.jsx',
    de: "export const ehDemonstracao = () => import.meta.env.VITE_AMBIENTE === 'demonstracao';",
    para: 'export const ehDemonstracao = () => true;',
    spec: 'testes/FaixaDeDemonstracao.test.jsx',
  },
  {
    descricao: 'demonstração: o Layout deixa de mostrar a faixa de demonstração',
    arquivo: 'src/components/Layout.jsx',
    de: '      <FaixaDeDemonstracao />\n\n',
    para: '',
    spec: 'testes/FaixaDeDemonstracao.test.jsx',
  },
  {
    descricao: 'sessão vencida: deixa de apagar as leituras guardadas para uso sem conexão',
    arquivo: 'src/context/AuthContext.jsx',
    de: "    function aoExpirar() {\n      limparDadosOffline();\n",
    para: "    function aoExpirar() {\n",
    spec: 'testes/ExpiracaoLimpaCache.test.jsx',
  },
  {
    descricao: 'sessão vencida: deixa de avisar que a sessão expirou',
    arquivo: 'src/context/AuthContext.jsx',
    de: "      setSessaoExpirada(true);\n    }\n\n    window.addEventListener(EVENTO_SESSAO_EXPIRADA",
    para: "    }\n\n    window.addEventListener(EVENTO_SESSAO_EXPIRADA",
    spec: 'testes/ExpiracaoLimpaCache.test.jsx',
  },
  // --- Acessibilidade (axe no e2e, título e foco na troca de tela) -------------
  {
    descricao: 'acessibilidade: o título da aba deixa de acompanhar a rota',
    arquivo: 'src/components/AnuncioDeRota.jsx',
    de: 'document.title = tituloDaRota(pathname);',
    para: "document.title = 'Conserva Predial';",
    spec: 'testes/AnuncioDeRota.test.jsx',
  },
  {
    descricao: 'acessibilidade: a troca de tela deixa de levar o foco ao título',
    arquivo: 'src/components/AnuncioDeRota.jsx',
    de: '    alvo.focus();\n',
    para: '',
    spec: 'testes/AnuncioDeRota.test.jsx',
  },
  {
    descricao: 'acessibilidade: a primeira carga passa a roubar o foco',
    arquivo: 'src/components/AnuncioDeRota.jsx',
    de: 'if (anterior.current === pathname) return;',
    para: 'if (false) return;',
    spec: 'testes/AnuncioDeRota.test.jsx',
  },
  {
    descricao: 'acessibilidade: trocar só a query passa a mover o foco',
    arquivo: 'src/components/AnuncioDeRota.jsx',
    de: 'const { pathname } = useLocation();',
    para: 'const { pathname: caminho, search } = useLocation();\n  const pathname = caminho + search;',
    spec: 'testes/AnuncioDeRota.test.jsx',
  },
  {
    descricao: 'acessibilidade: sem h1 o foco deixa de ir para o main',
    arquivo: 'src/components/AnuncioDeRota.jsx',
    de: "document.querySelector('h1') ?? document.querySelector('main')",
    para: "document.querySelector('h1')",
    spec: 'testes/AnuncioDeRota.test.jsx',
  },
  {
    descricao: 'acessibilidade: uma rota fica sem título próprio',
    arquivo: 'src/dominio/titulosDeRota.js',
    de: "  ['/etiquetas', 'Etiquetas'],\n",
    para: '',
    spec: 'testes/AnuncioDeRota.test.jsx',
  },
  {
    descricao: 'acessibilidade: "Novo chamado" passa depois de "Chamado" e vira o chamado "novo"',
    arquivo: 'src/dominio/titulosDeRota.js',
    de: "  ['/chamados/novo', 'Novo chamado'],\n  ['/chamados/:id', 'Chamado'],\n",
    para: "  ['/chamados/:id', 'Chamado'],\n  ['/chamados/novo', 'Novo chamado'],\n",
    spec: 'testes/AnuncioDeRota.test.jsx',
  },
  {
    descricao: 'acessibilidade: as seções da preventiva deixam de dizer qual está aberta',
    arquivo: 'src/pages/Preventiva.jsx',
    de: 'aria-pressed={aba === a.id}',
    para: '',
    spec: 'testes/Preventiva.test.jsx',
  },
  {
    descricao: 'acessibilidade: as seções dos cadastros deixam de dizer qual está aberta',
    arquivo: 'src/pages/Cadastros.jsx',
    de: 'aria-pressed={aba === a.id}',
    para: '',
    spec: 'testes/Cadastros.test.jsx',
  },
  {
    descricao: 'acessibilidade: o "(opcional)" volta ao cinza cru de 2,5:1 (vitest)',
    arquivo: 'src/pages/Cadastros.jsx',
    de: '<span> (opcional)</span>',
    para: '<span className="text-gray-400"> (opcional)</span>',
    spec: 'testes/contraste.test.js',
  },
  {
    descricao: 'acessibilidade: o "(opcional)" volta ao cinza cru de 2,5:1 (axe)',
    arquivo: 'src/pages/Cadastros.jsx',
    de: '<span> (opcional)</span>',
    para: '<span className="text-gray-400"> (opcional)</span>',
    motor: 'playwright',
    spec: 'e2e/acessibilidade.spec.js',
  },
  {
    descricao: 'acessibilidade: o link dentro da frase perde o sublinhado (axe)',
    arquivo: 'src/pages/Relatorios.jsx',
    de: '<Link to="/cadastros?aba=expediente" className="text-navy underline">',
    para: '<Link to="/cadastros?aba=expediente" className="text-navy">',
    motor: 'playwright',
    spec: 'e2e/acessibilidade.spec.js',
  },
  {
    descricao: 'acessibilidade: o select de técnico perde o nome acessível',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: 'aria-label="Técnico responsável"',
    para: '',
    spec: 'testes/ChamadoDetalhe.test.jsx',
  },
  {
    descricao: 'acessibilidade: o select da nota perde o nome acessível',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: 'aria-label="Nota do atendimento"',
    para: '',
    spec: 'testes/ChamadoDetalhe.test.jsx',
  },
  // --- Erros do sistema, avisos em segundo plano, telas sob demanda ------------
  {
    descricao: 'erros do sistema: a tela passa a consultar sem estar aberta',
    arquivo: 'src/components/ErrosDoSistema.jsx',
    de: 'if (!aberto || dados) return undefined;',
    para: 'if (dados) return undefined;',
    spec: 'testes/ErrosDoSistema.test.jsx',
  },
  {
    descricao: 'erros do sistema: o plural da contagem deixa de concordar',
    arquivo: 'src/components/ErrosDoSistema.jsx',
    de: 'dados.ultimas_24h === 1',
    para: 'false',
    spec: 'testes/ErrosDoSistema.test.jsx',
  },
  {
    descricao: 'avisos em segundo plano: a aba escondida volta a consultar a cada minuto',
    arquivo: 'src/components/Avisos.jsx',
    de: '      if (document.hidden) return;\n      carregar();',
    para: '      carregar();',
    spec: 'testes/Avisos.test.jsx',
  },
  {
    descricao: 'avisos em segundo plano: voltar para a aba deixa de consultar na hora',
    arquivo: 'src/components/Avisos.jsx',
    de: "    document.addEventListener('visibilitychange', consultar);\n    return () => {\n      clearInterval(id);",
    para: '    return () => {\n      clearInterval(id);',
    spec: 'testes/Avisos.test.jsx',
  },
  {
    descricao: 'avisos em segundo plano: desmontar deixa o evento solto',
    arquivo: 'src/components/Avisos.jsx',
    de: "      document.removeEventListener('visibilitychange', consultar);\n    };\n  }, [carregar]);",
    para: '    };\n  }, [carregar]);',
    spec: 'testes/Avisos.test.jsx',
  },
  {
    descricao: 'telas sob demanda: a tela de relatórios volta ao arquivo principal',
    arquivo: 'src/App.jsx',
    de: "const Relatorios = telaSobDemanda(() => import('./pages/Relatorios'));",
    para: "import Relatorios from './pages/Relatorios';",
    spec: 'testes/telaSobDemanda.test.jsx',
  },
  {
    descricao: 'telas sob demanda: o chamado (que o técnico lê sem conexão) vira sob demanda',
    arquivo: 'src/App.jsx',
    de: "import ChamadoDetalhe from './pages/ChamadoDetalhe';",
    para: "const ChamadoDetalhe = telaSobDemanda(() => import('./pages/ChamadoDetalhe'));",
    spec: 'testes/telaSobDemanda.test.jsx',
  },
  {
    descricao: 'telas sob demanda: o pedaço que sumiu deixa de recarregar a página',
    arquivo: 'src/dominio/telaSobDemanda.js',
    de: '        window.location.reload();\n',
    para: '',
    spec: 'testes/telaSobDemanda.test.jsx',
  },
  {
    descricao: 'telas sob demanda: o laço de recarga deixa de ser impedido',
    arquivo: 'src/dominio/telaSobDemanda.js',
    de: '        if (jaRecarregou) throw erro;',
    para: '',
    spec: 'testes/telaSobDemanda.test.jsx',
  },
  {
    descricao: 'telas sob demanda: a marca de recarga deixa de ser gravada',
    arquivo: 'src/dominio/telaSobDemanda.js',
    de: "if (!jaRecarregou) sessionStorage.setItem(MARCA, '1');",
    para: '',
    spec: 'testes/telaSobDemanda.test.jsx',
  },
  {
    descricao: 'telas sob demanda: sem armazenamento, passa a arriscar o laço',
    arquivo: 'src/dominio/telaSobDemanda.js',
    de: 'let jaRecarregou = true;',
    para: 'let jaRecarregou = false;',
    spec: 'testes/telaSobDemanda.test.jsx',
  },
  {
    descricao: 'telas sob demanda: o erro de carga deixa de ter botão para recarregar',
    arquivo: 'src/components/LimiteDeErro.jsx',
    de: 'onClick={() => window.location.reload()}',
    para: 'onClick={() => {}}',
    spec: 'testes/telaSobDemanda.test.jsx',
  },
  {
    descricao: 'telas sob demanda: o foco deixa de passar ao h1 que chega depois',
    arquivo: 'src/components/AnuncioDeRota.jsx',
    de: "    observador.observe(document.body, { childList: true, subtree: true });",
    para: '',
    spec: 'testes/AnuncioDeRota.test.jsx',
  },
  {
    descricao: 'telas sob demanda: o foco do h1 que chega depois passa a ser roubado',
    arquivo: 'src/components/AnuncioDeRota.jsx',
    de: 'if (document.activeElement === principal) focar(chegou);',
    para: 'focar(chegou);',
    spec: 'testes/AnuncioDeRota.test.jsx',
  },
  {
    descricao: 'na abertura, o formulário deixa de enviar a situação informada',
    arquivo: 'src/pages/NovoChamado.jsx',
    de: '...fatoresDaSituacao(form),',
    para: '',
    spec: 'testes/NovoChamado.test.jsx',
  },
  {
    descricao: 'na abertura, as perguntas de situação deixam de ser obrigatórias',
    arquivo: 'src/components/ui/EscolhaUnica.jsx',
    de: '              required\n',
    para: '',
    spec: 'testes/NovoChamado.test.jsx',
  },
  {
    descricao: 'na abertura, uma resposta já vem marcada',
    arquivo: 'src/pages/NovoChamado.jsx',
    de: "    urgencia: '',",
    para: "    urgencia: '1',",
    spec: 'testes/NovoChamado.test.jsx',
  },
  {
    descricao: 'na abertura, urgência e impacto trocam de lugar no envio',
    arquivo: 'src/dominio/situacao.js',
    de: 'urgencia: Number(situacao.urgencia),\n    impacto: Number(situacao.impacto),',
    para: 'urgencia: Number(situacao.impacto),\n    impacto: Number(situacao.urgencia),',
    spec: 'testes/NovoChamado.test.jsx',
  },
  {
    descricao: 'na abertura, uma resposta volta a trazer o nome do campo Equipamento',
    arquivo: 'src/dominio/situacao.js',
    de: "Risco de dano ao prédio ou a bens",
    para: "Risco para equipamentos ou para o prédio",
    spec: 'testes/NovoChamado.test.jsx',
  },
  {
    descricao: 'anexos, o envio continua ligado com o chamado no limite',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: 'disabled={Boolean(enviandoAnexo) || anexosNoLimite}',
    para: 'disabled={Boolean(enviandoAnexo)}',
    spec: 'testes/ChamadoDetalhe.test.jsx',
  },
  {
    descricao: 'anexos, a tela deixa de ler o limite que a API informa',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: 'setLimiteAnexos(data.limite ?? null);',
    para: 'setLimiteAnexos(null);',
    spec: 'testes/ChamadoDetalhe.test.jsx',
  },
  {
    descricao: 'anexos, o aviso de espaço aparece mesmo com espaço folgado',
    arquivo: 'src/components/AvisoDeEspaco.jsx',
    de: 'if (ativo && resposta?.data?.alerta) setUso(resposta.data);',
    para: 'if (ativo && resposta?.data) setUso(resposta.data);',
    spec: 'testes/AvisoDeEspaco.test.jsx',
  },
  {
    descricao: 'anexos, o aviso de espaço manda ligar o Storage a quem já o ligou',
    arquivo: 'src/components/AvisoDeEspaco.jsx',
    de: "const noStorage = uso.modo === 'supabase';",
    para: 'const noStorage = false;',
    spec: 'testes/AvisoDeEspaco.test.jsx',
  },
  {
    descricao: 'cadastro, a senha do formulário volta a aceitar 6 caracteres',
    arquivo: 'src/dominio/senha.js',
    de: 'export const MINIMO_SENHA = 10;',
    para: 'export const MINIMO_SENHA = 6;',
    spec: 'testes/CadastrosPendentes.test.jsx',
  },
  {
    descricao: 'cadastro, o formulário deixa de pedir o mínimo da senha',
    arquivo: 'src/pages/Cadastro.jsx',
    de: 'minLength={MINIMO_SENHA}',
    para: '',
    spec: 'testes/CadastrosPendentes.test.jsx',
  },
  {
    descricao: 'cadastro, a tela volta a afirmar que a conta foi criada (e o e-mail repetido a lê)',
    arquivo: 'src/pages/Cadastro.jsx',
    de: "'Recebemos o pedido de cadastro. Se este e-mail ainda não tinha conta, ela foi criada: entre com este e-mail e a senha que você escolheu. '",
    para: "'Conta criada! Entre com este e-mail e a senha que você escolheu. '",
    spec: 'testes/CadastrosPendentes.test.jsx',
  },
];

/**
 * Restauração à prova de interrupção.
 *
 * O `finally` de cada iteração devolve o arquivo ao original, mas não roda se
 * o processo for morto no meio — e aí o código fica mutado no disco, o que já
 * aconteceu: uma execução interrompida deixou o contador do sino somando as
 * notificações lidas. Guardar o original aqui e restaurar em qualquer saída
 * fecha esse buraco.
 */
const originais = new Map();

function restaurarTudo() {
  for (const [arquivo, conteudo] of originais) {
    fs.writeFileSync(arquivo, conteudo);
  }
  originais.clear();
}

for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'uncaughtException']) {
  process.on(sinal, (erro) => {
    restaurarTudo();
    console.error(`\n[mutacao] interrompido (${sinal}); arquivos restaurados.`);
    if (erro instanceof Error) console.error(erro.message);
    process.exit(1);
  });
}
process.on('exit', restaurarTudo);

let decoradas = 0;

const filtro = process.argv[2];
const busca = process.argv[3];

for (const { descricao, arquivo, de, para, spec, motor = 'vitest' } of MUTACOES) {
  if (filtro && filtro !== 'todas' && motor !== filtro) continue;
  if (busca && !descricao.includes(busca)) continue;
  if (!fs.existsSync(spec)) {
    console.log(`sem spec   | ${descricao}`);
    continue;
  }

  const original = fs.readFileSync(arquivo, 'utf8');
  if (!original.includes(de)) {
    console.log(`DESATUALIZADA | ${descricao} — o trecho mudou, atualize a mutação`);
    decoradas += 1;
    continue;
  }

  originais.set(arquivo, original);
  fs.writeFileSync(arquivo, original.replace(de, para));
  try {
    // O Playwright roda contra a build servida pelo preview: sem reconstruir,
    // a mutação ficaria só no código-fonte e a tela continuaria a antiga — a
    // mutação passaria "despercebida" por um motivo que não é o teste.
    const comando =
      motor === 'playwright'
        ? `npm run build --silent && npx playwright test ${spec}`
        : `npx vitest run ${spec}`;
    execSync(comando, { stdio: 'ignore' });
    console.log(`NÃO PEGOU  | ${descricao}`);
    decoradas += 1;
  } catch {
    console.log(`pegou      | ${descricao}`);
  } finally {
    fs.writeFileSync(arquivo, original);
    originais.delete(arquivo);
  }
}

console.log(
  decoradas === 0
    ? '\nTodas as mutações foram acusadas.'
    : `\n${decoradas} mutação(ões) passaram despercebidas — há teste decorativo aí.`
);
process.exit(decoradas === 0 ? 0 : 1);
