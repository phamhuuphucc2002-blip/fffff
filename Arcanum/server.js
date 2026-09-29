import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 10000);
const JWT_SECRET = String(process.env.JWT_SECRET || 'arcanum-development-secret-change-me');
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || '').trim();
const DATA_DIR = process.env.ARCANUM_DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'arcanum.json');
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: CORS_ORIGIN || true }));
app.use(express.json({ limit: '15mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false }));

let pool = null;
let storage = 'file';

const emptyDb = () => ({ users: [], workspaces: [], memberships: [] });

function ensureFileDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify(emptyDb(), null, 2));
}
function readFileDb() {
  ensureFileDb();
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return emptyDb(); }
}
function writeFileDb(db) {
  ensureFileDb();
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

const uid = p => p + '_' + crypto.randomBytes(10).toString('hex');
const joinCode = () => 'ARC-' + crypto.randomBytes(4).toString('hex').toUpperCase();
const normalizeEmail = x => String(x || '').trim().toLowerCase();
const cleanData = x => ({ version: 3, entries: Array.isArray(x?.entries) ? x.entries : [], notes: Array.isArray(x?.notes) ? x.notes : [] });

function hashPassword(password) {
  return bcrypt.hash(String(password), 12);
}
function tokenFor(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '30d' });
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Chưa đăng nhập' });
  try {
    const p = jwt.verify(h.slice(7), JWT_SECRET);
    req.userId = p.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn' });
  }
}

async function initStorage() {
  if (!DATABASE_URL) {
    storage = 'file';
    ensureFileDb();
    return;
  }
  try {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000
    });
    await pool.query('SELECT 1');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS arcanum_users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS arcanum_workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        join_code TEXT UNIQUE NOT NULL,
        version BIGINT NOT NULL DEFAULT 0,
        data JSONB NOT NULL DEFAULT '{"version":3,"entries":[],"notes":[]}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS arcanum_memberships (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES arcanum_users(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES arcanum_workspaces(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member',
        UNIQUE(user_id, workspace_id)
      );
      CREATE INDEX IF NOT EXISTS idx_arcanum_memberships_user ON arcanum_memberships(user_id);
    `);
    storage = 'postgres';
  } catch (e) {
    console.error('PostgreSQL unavailable; switching to file storage:', e.message);
    try { await pool?.end(); } catch {}
    pool = null;
    storage = 'file';
    ensureFileDb();
  }
}

async function getUser(id) {
  if (storage === 'postgres') return (await pool.query('SELECT id,email,name FROM arcanum_users WHERE id=$1', [id])).rows[0] || null;
  const db = readFileDb(); const u = db.users.find(x => x.id === id);
  return u ? { id: u.id, email: u.email, name: u.name } : null;
}
async function getWorkspaces(userId) {
  if (storage === 'postgres') {
    const r = await pool.query(`
      SELECT w.id,w.name,w.join_code,w.version,m.role
      FROM arcanum_workspaces w JOIN arcanum_memberships m ON m.workspace_id=w.id
      WHERE m.user_id=$1 ORDER BY w.created_at
    `, [userId]);
    return r.rows.map(x => ({ id:x.id, name:x.name, join_code:x.join_code, version:Number(x.version), role:x.role }));
  }
  const db = readFileDb();
  return db.memberships.filter(m => m.userId === userId).map(m => {
    const w = db.workspaces.find(x => x.id === m.workspaceId);
    return w ? { id:w.id, name:w.name, join_code:w.joinCode, version:w.version, role:m.role } : null;
  }).filter(Boolean);
}
async function accountPayload(userId, workspaceId = null) {
  const user = await getUser(userId);
  if (!user) return null;
  const workspaces = await getWorkspaces(userId);
  const workspace = workspaces.find(w => w.id === workspaceId) || workspaces[0] || null;
  return { user, workspaces, workspace };
}
async function createWorkspace(userId, name) {
  const w = { id:uid('ws'), name:name || 'Arcanum Library', joinCode:joinCode(), version:0, data:cleanData(null) };
  if (storage === 'postgres') {
    await pool.query('BEGIN');
    try {
      await pool.query('INSERT INTO arcanum_workspaces(id,name,join_code,data) VALUES($1,$2,$3,$4::jsonb)', [w.id,w.name,w.joinCode,JSON.stringify(w.data)]);
      await pool.query("INSERT INTO arcanum_memberships(id,user_id,workspace_id,role) VALUES($1,$2,$3,'owner')", [uid('mem'),userId,w.id]);
      await pool.query('COMMIT');
    } catch (e) { await pool.query('ROLLBACK'); throw e; }
  } else {
    const db = readFileDb();
    db.workspaces.push(w);
    db.memberships.push({ id:uid('mem'), userId, workspaceId:w.id, role:'owner' });
    writeFileDb(db);
  }
  return { id:w.id, name:w.name, join_code:w.joinCode, version:0, role:'owner' };
}
async function member(userId, workspaceId) {
  if (storage === 'postgres') return (await pool.query('SELECT role FROM arcanum_memberships WHERE user_id=$1 AND workspace_id=$2', [userId,workspaceId])).rows[0] || null;
  const db = readFileDb(); return db.memberships.find(m => m.userId === userId && m.workspaceId === workspaceId) || null;
}
async function workspace(workspaceId) {
  if (storage === 'postgres') {
    const r = (await pool.query('SELECT id,name,join_code,version,data FROM arcanum_workspaces WHERE id=$1', [workspaceId])).rows[0];
    return r ? { id:r.id,name:r.name,join_code:r.join_code,version:Number(r.version),data:cleanData(r.data) } : null;
  }
  const db = readFileDb(); return db.workspaces.find(w => w.id === workspaceId) || null;
}
async function register(email, password, name) {
  if (storage === 'postgres') {
    if ((await pool.query('SELECT 1 FROM arcanum_users WHERE email=$1',[email])).rowCount) throw Object.assign(new Error('Email đã tồn tại'), { status:409 });
    const id = uid('usr');
    await pool.query('INSERT INTO arcanum_users(id,email,name,password_hash) VALUES($1,$2,$3,$4)', [id,email,name,await hashPassword(password)]);
    const ws = await createWorkspace(id, 'Arcanum Library');
    return { id, ws };
  }
  const db = readFileDb();
  if (db.users.some(u => u.email === email)) throw Object.assign(new Error('Email đã tồn tại'), { status:409 });
  const id = uid('usr');
  db.users.push({ id,email,name,passwordHash:await hashPassword(password),createdAt:new Date().toISOString() });
  writeFileDb(db);
  const ws = await createWorkspace(id, 'Arcanum Library');
  return { id, ws };
}
async function findLoginUser(email) {
  if (storage === 'postgres') return (await pool.query('SELECT id,email,name,password_hash FROM arcanum_users WHERE email=$1',[email])).rows[0] || null;
  const db = readFileDb(); const u = db.users.find(x => x.email === email);
  return u ? { id:u.id,email:u.email,name:u.name,password_hash:u.passwordHash } : null;
}

app.get('/api/health', async (_req,res) => {
  let db = false;
  if (storage === 'postgres') { try { await pool.query('SELECT 1'); db = true; } catch {} }
  res.json({ ok:true, app:'Arcanum Cloud', version:'5.0.0', storage, databaseConfigured:!!DATABASE_URL, databaseReachable:db, time:new Date().toISOString() });
});
app.get('/health', (_req,res) => res.json({ ok:true, app:'Arcanum Cloud', storage }));

app.post('/api/auth/register', async (req,res) => {
  try {
    const email=normalizeEmail(req.body.email), password=String(req.body.password||''), name=(String(req.body.name||'').trim()||email.split('@')[0]).slice(0,100);
    if (!email.includes('@')) return res.status(400).json({error:'Email không hợp lệ'});
    if (password.length < 8) return res.status(400).json({error:'Mật khẩu phải có ít nhất 8 ký tự'});
    const r=await register(email,password,name);
    const p=await accountPayload(r.id,r.ws.id);
    res.status(201).json({ token:tokenFor(r.id), ...p });
  } catch(e) { console.error(e); res.status(e.status||500).json({error:e.message||'Không thể tạo tài khoản'}); }
});

app.post('/api/auth/login', async (req,res) => {
  try {
    const email=normalizeEmail(req.body.email), password=String(req.body.password||'');
    const u=await findLoginUser(email);
    if (!u || !(await bcrypt.compare(password,u.password_hash))) return res.status(401).json({error:'Email hoặc mật khẩu không đúng'});
    const p=await accountPayload(u.id);
    res.json({ token:tokenFor(u.id), ...p });
  } catch(e) { console.error(e); res.status(500).json({error:'Không thể đăng nhập'}); }
});

app.get('/api/auth/me', auth, async (req,res) => {
  const p=await accountPayload(req.userId);
  if (!p) return res.status(401).json({error:'Tài khoản không tồn tại'});
  res.json(p);
});

app.post('/api/workspaces', auth, async (req,res) => {
  try {
    const w=await createWorkspace(req.userId,String(req.body.name||'').trim()||'Arcanum Library');
    const p=await accountPayload(req.userId,w.id);
    res.status(201).json(p);
  } catch(e) { console.error(e); res.status(500).json({error:'Không thể tạo workspace'}); }
});

app.post('/api/workspaces/join', auth, async (req,res) => {
  try {
    const code=String(req.body.joinCode||'').trim().toUpperCase();
    let w=null;
    if (storage==='postgres') w=(await pool.query('SELECT id FROM arcanum_workspaces WHERE join_code=$1',[code])).rows[0]||null;
    else { const db=readFileDb(); w=db.workspaces.find(x=>x.joinCode===code)||null; }
    if (!w) return res.status(404).json({error:'Không tìm thấy workspace với mã này'});
    if (!(await member(req.userId,w.id))) {
      if (storage==='postgres') await pool.query("INSERT INTO arcanum_memberships(id,user_id,workspace_id,role) VALUES($1,$2,$3,'member')",[uid('mem'),req.userId,w.id]);
      else { const db=readFileDb(); db.memberships.push({id:uid('mem'),userId:req.userId,workspaceId:w.id,role:'member'}); writeFileDb(db); }
    }
    res.json(await accountPayload(req.userId,w.id));
  } catch(e) { console.error(e); res.status(500).json({error:'Không thể tham gia workspace'}); }
});

app.get('/api/workspaces/:id/data', auth, async (req,res) => {
  try {
    const m=await member(req.userId,req.params.id); if(!m) return res.status(403).json({error:'Bạn chưa tham gia workspace này'});
    const w=await workspace(req.params.id); if(!w) return res.status(404).json({error:'Workspace không tồn tại'});
    res.json({workspace:{id:w.id,name:w.name,join_code:w.join_code||w.joinCode,role:m.role,version:Number(w.version||0)},version:Number(w.version||0),data:cleanData(w.data)});
  } catch(e) { console.error(e); res.status(500).json({error:'Không thể lấy dữ liệu cloud'}); }
});

app.put('/api/workspaces/:id/data', auth, async (req,res) => {
  try {
    const m=await member(req.userId,req.params.id); if(!m) return res.status(403).json({error:'Bạn chưa tham gia workspace này'});
    if(!['owner','member','editor'].includes(m.role)) return res.status(403).json({error:'Bạn không có quyền chỉnh sửa'});
    const w=await workspace(req.params.id); if(!w) return res.status(404).json({error:'Workspace không tồn tại'});
    const base=Number(req.body.baseVersion);
    if(!Number.isInteger(base) || base!==Number(w.version||0)) return res.status(409).json({error:'Workspace đã được cập nhật. Hãy lấy dữ liệu cloud trước.',version:Number(w.version||0),data:cleanData(w.data)});
    const next=cleanData(req.body.data);
    if(storage==='postgres') await pool.query('UPDATE arcanum_workspaces SET data=$1::jsonb,version=version+1 WHERE id=$2',[JSON.stringify(next),w.id]);
    else { const db=readFileDb(); const fw=db.workspaces.find(x=>x.id===w.id); fw.data=next; fw.version=Number(fw.version||0)+1; writeFileDb(db); }
    const nw=await workspace(w.id);
    res.json({workspace:{id:nw.id,name:nw.name,join_code:nw.join_code||nw.joinCode,role:m.role,version:Number(nw.version)},version:Number(nw.version),data:cleanData(nw.data)});
  } catch(e) { console.error(e); res.status(500).json({error:'Không thể ghi dữ liệu cloud'}); }
});

app.use((_req,res) => {
  const file=path.join(__dirname,'Arcanum_CloudSync.html');
  if(!fs.existsSync(file)) return res.status(404).send('Arcanum UI not found');
  res.type('html').send(fs.readFileSync(file,'utf8'));
});

initStorage()
  .then(() => app.listen(PORT,'0.0.0.0',() => console.log(`Arcanum Cloud running on 0.0.0.0:${PORT} storage=${storage}`)))
  .catch(e => { console.error('Startup failure:',e); process.exit(1); });
