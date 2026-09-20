const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { getPermissionsForUser } = require('../utils/permissions');

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = await db('users')
    .select('users.*', 'roles.name as role')
    .join('roles', 'roles.id', 'users.role_id')
    .where('users.email', email)
    .first();

  if (!user || user.status !== 'active') {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  await db('users').where('id', user.id).update({ last_login_at: db.fn.now() });

  const token = jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });

  const permissions = await getPermissionsForUser(user.id);

  res.json({
    token,
    user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role, permissions },
  });
}

// Only reachable by users with 'employees.manage' permission (store manager / admin)
async function createEmployee(req, res) {
  const { full_name, email, phone, password, role_name } = req.body;
  if (!full_name || !password || !role_name || (!email && !phone)) {
    return res.status(400).json({ error: 'full_name, password, role_name and email or phone are required' });
  }

  const role = await db('roles').where('name', role_name).first();
  if (!role) {
    return res.status(400).json({ error: `Unknown role: ${role_name}` });
  }

  const password_hash = await bcrypt.hash(password, 10);

  const [newUser] = await db('users')
    .insert({
      full_name,
      email: email || null,
      phone: phone || null,
      password_hash,
      role_id: role.id,
      created_by: req.user.id,
    })
    .returning(['id', 'full_name', 'email', 'phone']);

  res.status(201).json({ ...newUser, role: role.name });
}

async function listEmployees(req, res) {
  const employees = await db('users')
    .select('users.id', 'users.full_name', 'users.email', 'users.phone', 'users.status', 'roles.name as role', 'users.last_login_at')
    .join('roles', 'roles.id', 'users.role_id')
    .orderBy('users.full_name');
  res.json(employees);
}

// PATCH /api/auth/employees/:id { full_name?, email?, phone?, role_name?, status?, password? }
// Only reachable by users with 'employees.manage' permission (store manager / admin)
async function updateEmployee(req, res) {
  const { id } = req.params;
  const { full_name, email, phone, role_name, status, password } = req.body;

  if (status && !['active', 'disabled'].includes(status)) {
    return res.status(400).json({ error: "status must be 'active' or 'disabled'" });
  }

  const updates = {};
  if (full_name !== undefined) updates.full_name = full_name;
  if (email !== undefined) updates.email = email || null;
  if (phone !== undefined) updates.phone = phone || null;
  if (status !== undefined) updates.status = status;

  if (role_name !== undefined) {
    const role = await db('roles').where('name', role_name).first();
    if (!role) return res.status(400).json({ error: `Unknown role: ${role_name}` });
    updates.role_id = role.id;
  }

  if (password) {
    updates.password_hash = await bcrypt.hash(password, 10);
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const [updated] = await db('users').where({ id }).update(updates).returning(['id']);
  if (!updated) return res.status(404).json({ error: 'Employee not found' });

  const employee = await db('users')
    .select('users.id', 'users.full_name', 'users.email', 'users.phone', 'users.status', 'roles.name as role', 'users.last_login_at')
    .join('roles', 'roles.id', 'users.role_id')
    .where('users.id', id)
    .first();
  res.json(employee);
}

module.exports = { login, createEmployee, listEmployees, updateEmployee };
