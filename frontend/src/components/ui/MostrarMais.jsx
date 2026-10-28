import Botao from './Botao';

/**
 * Lista longa: mostra o começo e libera o resto sob demanda.
 *
 * Uma instituição pode ter milhares de locais e centenas de contas. Desenhar tudo de uma vez custa
 * dezenas de milhares de elementos na tela (medido: 10 mil no cadastro de locais, 13 mil nas contas),
 * e é o que deixa a tela lenta num celular simples, não a rede. O filtro continua valendo para a lista
 * inteira; só o desenho é adiado. Sai do ar quando já não há o que mostrar.
 */
function MostrarMais({ mostrando, total, passo, onMais, nome = 'itens' }) {
  const restam = total - mostrando;
  if (restam <= 0) return null;
  return (
    <div className="mt-3 flex items-center gap-3">
      <Botao variante="secundaria" tamanho="sm" type="button" onClick={onMais}>
        Mostrar mais {Math.min(passo, restam)}
      </Botao>
      <span className="text-xs text-tinta-2">
        Mostrando {mostrando} de {total} {nome}.
      </span>
    </div>
  );
}

export default MostrarMais;
