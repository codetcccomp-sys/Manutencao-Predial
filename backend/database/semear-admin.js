#!/usr/bin/env node
/**
 * Garante um administrador conhecido, para os testes de ponta a ponta.
 *
 * O cadastro público só cria solicitante, de propósito — é a RN01 —, então
 * não há como a suíte chegar a um administrador pela própria interface. Este
 * script abre essa porta uma única vez; daí em diante todos os outros perfis
 * são criados pela rota de administração, que é o caminho que precisa
 * continuar funcionando.
 *
 * Trava contra produção: um script que cria administrador com senha conhecida
 * é exatamente o tipo de coisa que não pode rodar por engano no banco errado.
 * Exige NODE_ENV diferente de production e as credenciais vindas do ambiente,
 * sem valor padrão — sem elas, não faz nada.
 *
 * Uso:
 *   E2E_ADMIN_EMAIL=... E2E_ADMIN_SENHA=... node database/semear-admin.js
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../src/config/db');

async function executar() {
  if (process.env.NODE_ENV === 'production') {
    console.error('[semear-admin] recusado: NODE_ENV=production.');
    process.exit(1);
  }

  const email = String(process.env.E2E_ADMIN_EMAIL || '').toLowerCase();
  const senha = process.env.E2E_ADMIN_SENHA;

  if (!email || !senha) {
    console.error('[semear-admin] defina E2E_ADMIN_EMAIL e E2E_ADMIN_SENHA.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(senha, 10);

  // Idempotente: a suíte roda muitas vezes contra o mesmo banco, e falhar na
  // segunda execução seria um jeito bobo de quebrar o CI.
  const { rows } = await pool.query(
    `INSERT INTO usuario (nome, email, senha_hash, perfil, ativo)
     VALUES ('Administrador de teste', $1, $2, 'administrador', TRUE)
     ON CONFLICT (email) DO UPDATE
        SET senha_hash = EXCLUDED.senha_hash,
            perfil = 'administrador',
            ativo = TRUE
     RETURNING id, email, perfil`,
    [email, hash]
  );

  console.log(`[semear-admin] pronto: ${rows[0].email} (${rows[0].perfil})`);
  await pool.end();
}

executar().catch(async (err) => {
  console.error('[semear-admin] falhou:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
