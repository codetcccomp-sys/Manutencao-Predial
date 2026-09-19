const pool = require('../config/db');
const { transacao } = require('../config/transacao');
const { AppError } = require('../middlewares/errorHandler');
const { analisar } = require('../utils/csv');

const NIVEIS = ['unidade', 'bloco', 'pavimento', 'setor', 'ambiente'];

const LIMITE = {
  unidade: 150,
  bloco: 100,
  pavimento: 100,
  setor: 100,
  ambiente: 150,
};

// Um prédio tem dezenas ou centenas de ambientes, não milhares. O teto existe
// para que um arquivo errado — a planilha inteira da instituição, um dump — não
// vire uma transação de horas, e porque o corpo da requisição é JSON com o
// limite padrão do Express (100 kB): 500 linhas cabem com folga, 5000 não.
const MAXIMO_LINHAS = 500;

/**
 * A chave natural do local, em SQL.
 *
 * Repetida em três lugares — o índice único da migração 014, o ON CONFLICT
 * daqui e a consulta de locais desativados — ela precisa ser literalmente a
 * mesma expressão, ou o ON CONFLICT não encontra o índice e o INSERT passa a
 * estourar em vez de conciliar. Por isso é montada por função a partir de uma
 * lista só.
 */
function chaveNatural(tabela = '') {
  const prefixo = tabela ? `${tabela}.` : '';
  return NIVEIS.map((nivel) =>
    nivel === 'unidade'
      ? `lower(btrim(${prefixo}unidade))`
      : `lower(btrim(coalesce(${prefixo}${nivel}, '')))`
  );
}

const CONFLITO = `ON CONFLICT (${chaveNatural().join(', ')}) DO NOTHING`;

/**
 * O rótulo legível do local, em SQL.
 *
 * O local é hierárquico no papel e plano na tabela; enquanto for assim, o
 * rótulo é montado na consulta, pulando os níveis não preenchidos — senão
 * "Prédio A" sem bloco sairia como "Prédio A /  /  /  / Sala 101".
 */
function rotuloSql(alias = 'l') {
  return `${alias}.unidade${NIVEIS.slice(1)
    .map((nivel) => ` || coalesce(' / ' || ${alias}.${nivel}, '')`)
    .join('')}`;
}

const INSERIR = `
  INSERT INTO local (unidade, bloco, pavimento, setor, ambiente)
       VALUES ($1, $2, $3, $4, $5)
       ${CONFLITO}
    RETURNING *`;

function chaveDe(campos) {
  return NIVEIS.map((nivel) => String(campos[nivel] || '').trim().toLowerCase());
}

function rotuloDe(campos) {
  return NIVEIS.map((nivel) => campos[nivel])
    .filter(Boolean)
    .join(' / ');
}

async function listar({ incluirInativos = false } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM local ${incluirInativos ? '' : 'WHERE ativo = TRUE'}
      ORDER BY ativo DESC, unidade, bloco, pavimento, setor, ambiente`
  );
  return rows;
}

/**
 * Cadastra um local, recusando o que já existe.
 *
 * Antes do índice único, cadastrar "Sala 101" duas vezes criava duas salas
 * 101: as duas apareciam no seletor de abertura, os chamados se dividiam entre
 * elas e o relatório por local passava a contar metade em cada. Agora o banco
 * recusa, e a recusa precisa chegar à tela como conflito — não como erro
 * interno.
 */
async function criar(campos) {
  const valores = NIVEIS.map((nivel) => {
    const valor = typeof campos[nivel] === 'string' ? campos[nivel].trim() : campos[nivel];
    return valor === '' || valor === undefined ? null : valor;
  });

  const { rows } = await pool.query(INSERIR, valores);
  if (!rows[0]) {
    throw new AppError('Este local já está cadastrado.', 409, 'LOCAL_DUPLICADO');
  }
  return rows[0];
}

async function atualizar(id, campos) {
  const atribuicoes = [];
  const params = [];

  for (const campo of [...NIVEIS, 'ativo']) {
    if (campos[campo] === undefined) continue;
    params.push(campos[campo] === '' ? null : campos[campo]);
    atribuicoes.push(`${campo} = $${params.length}`);
  }

  if (atribuicoes.length === 0) {
    throw new AppError('Informe ao menos um campo para atualizar.', 422, 'NADA_A_ATUALIZAR');
  }

  params.push(id);

  let rows;
  try {
    ({ rows } = await pool.query(
      `UPDATE local SET ${atribuicoes.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    ));
  } catch (err) {
    // 23505: renomear um local para o nome de outro que já existe.
    if (err.code === '23505') {
      throw new AppError('Já existe outro local com esses dados.', 409, 'LOCAL_DUPLICADO');
    }
    throw err;
  }

  if (!rows[0]) {
    throw new AppError('Local não encontrado.', 404, 'LOCAL_NAO_ENCONTRADO');
  }
  return rows[0];
}

// ---------------------------------------------------------------------------
// Carga em massa
// ---------------------------------------------------------------------------

function semAcento(texto) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Desfaz a neutralização de fórmula que a exportação aplica.
 *
 * A exportação prefixa com apóstrofo os valores que começam por `=`, `+`, `-`
 * ou `@`, para que o Excel não os execute. Sem desfazer aqui, exportar e
 * reimportar o mesmo arquivo renomearia "-Subsolo" para "'-Subsolo" e criaria
 * um local novo em vez de reconhecer o que já existe.
 */
function desneutralizar(texto) {
  return /^'[=+\-@\t]/.test(texto) ? texto.slice(1) : texto;
}

function normalizarCabecalho(nome) {
  return semAcento(String(nome).trim().toLowerCase());
}

/**
 * Confere o cabeçalho e devolve a posição de cada nível.
 *
 * Exigir cabeçalho, em vez de adivinhar pela ordem das colunas, é o que
 * permite recusar uma planilha em que bloco e pavimento estão trocados. Sem
 * ele, o arquivo entraria inteiro e errado — o pior desfecho possível para uma
 * carga inicial, porque nada acusa.
 */
function mapearColunas(valores) {
  const problemas = [];
  const posicoes = {};

  valores.forEach((bruto, indice) => {
    const nome = normalizarCabecalho(bruto);
    if (nome === '') return;
    if (!NIVEIS.includes(nome)) {
      problemas.push(`Coluna "${String(bruto).trim()}" não é reconhecida.`);
      return;
    }
    if (posicoes[nome] !== undefined) {
      problemas.push(`Coluna "${nome}" aparece mais de uma vez.`);
      return;
    }
    posicoes[nome] = indice;
  });

  if (posicoes.unidade === undefined && problemas.length === 0) {
    problemas.push('O arquivo precisa de uma coluna "unidade".');
  }

  if (problemas.length > 0) {
    throw new AppError(
      'O cabeçalho do arquivo não foi reconhecido.',
      422,
      'CABECALHO_INVALIDO',
      problemas.concat(`Colunas aceitas: ${NIVEIS.join(', ')}.`)
    );
  }

  return posicoes;
}

function lerLinha(registro, posicoes) {
  const campos = {};
  const problemas = [];

  for (const nivel of NIVEIS) {
    const indice = posicoes[nivel];
    const bruto = indice === undefined ? '' : (registro.valores[indice] ?? '');
    const valor = desneutralizar(String(bruto).trim());

    if (valor.length > LIMITE[nivel]) {
      problemas.push(
        `Linha ${registro.linha}: "${nivel}" passa de ${LIMITE[nivel]} caracteres.`
      );
    }
    campos[nivel] = valor === '' ? null : valor;
  }

  const colunasDeclaradas = Math.max(...Object.values(posicoes)) + 1;
  if (registro.valores.length > colunasDeclaradas) {
    problemas.push(
      `Linha ${registro.linha}: tem mais colunas do que o cabeçalho declara.`
    );
  }

  if (!campos.unidade) {
    problemas.push(`Linha ${registro.linha}: "unidade" é obrigatória.`);
  } else if (campos.unidade.length < 2) {
    problemas.push(`Linha ${registro.linha}: "unidade" deve ter ao menos 2 caracteres.`);
  }

  return { campos, problemas };
}

/**
 * Importa locais a partir de um CSV.
 *
 * Tudo ou nada, de propósito. A alternativa — gravar as linhas boas e relatar
 * as ruins — deixa quem importou com meia planilha dentro e a pergunta de
 * quais linhas repetir. Com o arquivo inteiro recusado e a lista completa de
 * problemas em mãos, corrige-se uma vez e reenvia-se o mesmo arquivo; o índice
 * único garante que reenviar não duplica nada.
 */
async function importar(csv) {
  const { registros } = analisar(csv);

  if (registros.length === 0) {
    throw new AppError('O arquivo está vazio.', 422, 'ARQUIVO_VAZIO');
  }

  const posicoes = mapearColunas(registros[0].valores);
  const linhas = registros.slice(1);

  if (linhas.length === 0) {
    throw new AppError('O arquivo só tem o cabeçalho.', 422, 'ARQUIVO_SEM_DADOS');
  }
  if (linhas.length > MAXIMO_LINHAS) {
    throw new AppError(
      `O arquivo tem ${linhas.length} linhas; o limite é ${MAXIMO_LINHAS}. Divida-o em partes.`,
      422,
      'ARQUIVO_GRANDE'
    );
  }

  const problemas = [];
  const aGravar = [];
  const vistas = new Map();

  for (const registro of linhas) {
    const { campos, problemas: doRegistro } = lerLinha(registro, posicoes);
    problemas.push(...doRegistro);
    if (doRegistro.length > 0) continue;

    // Linha repetida dentro do próprio arquivo é quase sempre erro de
    // digitação em uma das duas — dois ambientes diferentes em que um ficou
    // com o nome do outro. Descartar em silêncio esconderia o ambiente que
    // ficou de fora, então o arquivo volta para conferência.
    const chave = chaveDe(campos).join('\u0000');
    if (vistas.has(chave)) {
      problemas.push(
        `Linha ${registro.linha}: repete a linha ${vistas.get(chave)} ("${rotuloDe(campos)}").`
      );
      continue;
    }
    vistas.set(chave, registro.linha);
    aGravar.push(campos);
  }

  if (problemas.length > 0) {
    throw new AppError(
      `O arquivo não foi importado: ${problemas.length} ${
        problemas.length === 1 ? 'problema encontrado' : 'problemas encontrados'
      }.`,
      422,
      'ARQUIVO_INVALIDO',
      problemas
    );
  }

  return transacao(async (client) => {
    const criados = [];
    for (const campos of aGravar) {
      const { rows } = await client.query(
        INSERIR,
        NIVEIS.map((nivel) => campos[nivel])
      );
      if (rows[0]) criados.push(rows[0]);
    }

    // Um local do arquivo que já existe desativado não é reativado em
    // silêncio: quem o desativou teve um motivo, e uma planilha reenviada não
    // é decisão de reativar. Mas some do seletor de abertura, então precisa
    // aparecer no relatório — senão o chamado daquele ambiente fica sem onde
    // ser aberto e ninguém entende por quê.
    const { rows: desativados } = await client.query(
      `SELECT l.* FROM local l
         JOIN unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
              AS arquivo(${NIVEIS.join(', ')})
           ON ${chaveNatural('l')
             .map((expressao, i) => `${expressao} = arquivo.${NIVEIS[i]}`)
             .join(' AND ')}
        WHERE NOT l.ativo
        ORDER BY l.unidade, l.bloco, l.pavimento, l.setor, l.ambiente`,
      NIVEIS.map((_, i) => aGravar.map((campos) => chaveDe(campos)[i]))
    );

    return {
      linhas: aGravar.length,
      criados: criados.length,
      ja_existiam: aGravar.length - criados.length,
      desativados: desativados.map((l) => ({ id: l.id, rotulo: rotuloDe(l) })),
    };
  });
}

module.exports = {
  NIVEIS,
  MAXIMO_LINHAS,
  listar,
  criar,
  atualizar,
  importar,
  chaveNatural,
  rotuloSql,
  CONFLITO,
};
