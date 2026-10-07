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
    descricao: 'interceptor dispara mesmo sem token guardado',
    arquivo: 'src/api/client.js',
    de: "const tinhaSessao = Boolean(localStorage.getItem('smp_token'));",
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

for (const { descricao, arquivo, de, para, spec, motor = 'vitest' } of MUTACOES) {
  if (filtro && motor !== filtro) continue;
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
