import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
if (!JWT_SECRET || !DATABASE_URL) {
  console.error('Missing JWT_SECRET or DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false } });
const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN }));
app.use(express.json({ limit: '12mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));

const SCHEMA = await fs.readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');
await pool.query(SCHEMA);

const staticDir = path.dirname(fileURLToPath(import.meta.url));
app.get('/', (_req, res) => res.sendFile(path.join(staticDir, 'Arcanum_CloudSync.html')));
app.get('/arcanum', (_req, res) => res.sendFile(path.join(staticDir, 'Arcanum_CloudSync.html')));

const nowIso = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
const normalizeEmail = x => String(x || '').trim().toLowerCase();
const normalizeData = data => ({ version: 3, entries: Array.isArray(data?.entries) ? data.entries : [], notes: [] });
function sign(userId) { return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '30d' }); }
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try { req.userId = jwt.verify(h.slice(7), JWT_SECRET).sub; next(); }
  catch { return res.status(401).json({ error: 'Session expired' }); }
}
async function getUser(userId) {
  const r = await pool.query('SELECT id,email,display_name FROM users WHERE id=$1', [userId]);
  return r.rows[0] || null;
}
async function getWorkspaceForUser(userId, workspaceId) {
  const r = await pool.query(`SELECT w.id,w.name,w.join_code,wm.role,COALESCE(wd.version,0) AS version\n    FROM workspaces w JOIN workspace_members wm ON wm.workspace_id=w.id AND wm.user_id=$1\n    LEFT JOIN workspace_data wd ON wd.workspace_id=w.id WHERE w.id=$2`, [userId, workspaceId]);
  return r.rows[0] || null;
}
async function getWorkspaces(userId) {
  const r = await pool.query(`SELECT w.id,w.name,wm.role,COALESCE(wd.version,0) AS version,w.join_code\n    FROM workspaces w JOIN workspace_members wm ON wm.workspace_id=w.id AND wm.user_id=$1\n    LEFT JOIN workspace_data wd ON wd.workspace_id=w.id ORDER BY w.created_at`, [userId]);
  return r.rows;
}
async function defaultWorkspace(userId) {
  const xs = await getWorkspaces(userId);
  return xs[0] || null;
}
async function workspaceResponse(userId, workspaceId) {
  const user = await getUser(userId);
  const workspaces = await getWorkspaces(userId);
  const workspace = workspaceId ? await getWorkspaceForUser(userId, workspaceId) : await defaultWorkspace(userId);
  return { user: { id: user.id, email: user.email, name: user.display_name }, workspaces, workspace };
}

app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, time: nowIso() }); }
  catch { res.status(503).json({ ok: false }); }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email), password = String(req.body.password || ''), name = String(req.body.name || '').trim().slice(0,100);
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email không hợp lệ' });
    if (password.length < 8) return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 8 ký tự' });
    const exists = await pool.query('SELECT 1 FROM users WHERE email=$1', [email]);
    if (exists.rowCount) return res.status(409).json({ error: 'Email đã tồn tại' });
    const userId = newId(), hash = await bcrypt.hash(password, 12);
    await pool.query('INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,$3,$4)', [userId,email,hash,name || email.split('@')[0]]);
    const wsId = newId(), joinCode = 'ARC-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    await pool.query('INSERT INTO workspaces(id,name,join_code,created_by) VALUES($1,$2,$3,$4)', [wsId,'Arcanum Library',joinCode,userId]);
    await pool.query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,\'owner\')', [wsId,userId]);
    await pool.query('INSERT INTO workspace_data(workspace_id,data) VALUES($1,$2)', [wsId,JSON.stringify({version:3,entries:[],notes:[]})]);
    const payload = await workspaceResponse(userId, wsId);
    res.status(201).json({ token: sign(userId), ...payload });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Không thể tạo tài khoản' }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email), password = String(req.body.password || '');
    const r = await pool.query('SELECT id,email,password_hash,display_name FROM users WHERE email=$1', [email]);
    const user = r.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' });
    res.json({ token: sign(user.id), ...(await workspaceResponse(user.id)) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Không thể đăng nhập' }); }
});

app.get('/api/auth/me', auth, async (req, res) => {
  try { res.json(await workspaceResponse(req.userId)); }
  catch { res.status(500).json({ error: 'Không thể tải tài khoản' }); }
});

app.post('/api/workspaces', auth, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0,120);
    if (!name) return res.status(400).json({ error: 'Tên workspace không được trống' });
    const wsId = newId(), joinCode = 'ARC-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    await pool.query('INSERT INTO workspaces(id,name,join_code,created_by) VALUES($1,$2,$3,$4)', [wsId,name,joinCode,req.userId]);
    await pool.query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,\'owner\')', [wsId,req.userId]);
    await pool.query('INSERT INTO workspace_data(workspace_id,data) VALUES($1,$2)', [wsId,JSON.stringify({version:3,entries:[],notes:[]})]);
    const payload = await workspaceResponse(req.userId, wsId);
    res.status(201).json(payload);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Không thể tạo workspace' }); }
});

app.post('/api/workspaces/join', auth, async (req, res) => {
  try {
    const code = String(req.body.joinCode || '').trim().toUpperCase();
    const r = await pool.query('SELECT id FROM workspaces WHERE join_code=$1', [code]);
    if (!r.rowCount) return res.status(404).json({ error: 'Không tìm thấy workspace với mã này' });
    const wsId = r.rows[0].id;
    await pool.query(`INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'editor') ON CONFLICT (workspace_id,user_id) DO NOTHING`, [wsId,req.userId]);
    const payload = await workspaceResponse(req.userId, wsId);
    res.json(payload);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Không thể tham gia workspace' }); }
});

app.get('/api/workspaces/:id/data', auth, async (req, res) => {
  try {
    const ws = await getWorkspaceForUser(req.userId, req.params.id);
    if (!ws) return res.status(403).json({ error: 'Bạn không thuộc workspace này' });
    const r = await pool.query('SELECT version,data,updated_at FROM workspace_data WHERE workspace_id=$1', [ws.id]);
    const row = r.rows[0] || { version: 0, data: { version:3, entries:[], notes:[] } };
    res.json({ workspace: ws, version: row.version, data: normalizeData(row.data), updatedAt: row.updated_at });
  } catch { res.status(500).json({ error: 'Không thể lấy dữ liệu cloud' }); }
});

app.put('/api/workspaces/:id/data', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const ws = await getWorkspaceForUser(req.userId, req.params.id);
    if (!ws) return res.status(403).json({ error: 'Bạn không thuộc workspace này' });
    if (!['owner','editor'].includes(ws.role)) return res.status(403).json({ error: 'Bạn không có quyền chỉnh sửa workspace' });
    const baseVersion = Number(req.body.baseVersion);
    const data = normalizeData(req.body.data);
    await client.query('BEGIN');
    const q = await client.query('SELECT version FROM workspace_data WHERE workspace_id=$1 FOR UPDATE', [ws.id]);
    const current = q.rows[0]?.version ?? 0;
    if (!Number.isInteger(baseVersion) || baseVersion !== current) {
      await client.query('ROLLBACK');
      const latest = await pool.query('SELECT version,data,updated_at FROM workspace_data WHERE workspace_id=$1', [ws.id]);
      return res.status(409).json({ error: 'Workspace đã thay đổi', version: latest.rows[0]?.version ?? current, data: normalizeData(latest.rows[0]?.data) });
    }
    const next = current + 1;
    await client.query('UPDATE workspace_data SET version=$1,data=$2,updated_by=$3,updated_at=NOW() WHERE workspace_id=$4', [next,JSON.stringify(data),req.userId,ws.id]);
    await client.query('COMMIT');
    res.json({ ok:true, version:next, data, workspace:{...ws,version:next} });
  } catch (e) { try{await client.query('ROLLBACK')}catch{}; console.error(e); res.status(500).json({ error: 'Không thể ghi dữ liệu cloud' }); }
  finally { client.release(); }
});

app.listen(PORT, () => console.log(`Arcanum Cloud Sync listening on :${PORT}`));
