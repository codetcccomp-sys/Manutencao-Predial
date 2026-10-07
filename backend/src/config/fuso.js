// O fuso da instituição. O servidor roda em UTC (Vercel); "dia", "expediente"
// e "fim do dia previsto" são sempre no relógio de quem trabalha no prédio.
const FUSO = process.env.FUSO_HORARIO || 'America/Sao_Paulo';

module.exports = { FUSO };
