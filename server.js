const express=require('express');
const cors=require('cors');
const path=require('path');
const fs=require('fs');
const Database=require('better-sqlite3');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const OPENAI_API_KEY=process.env.OPENAI_API_KEY||'';
const OPENAI_MODEL=process.env.OPENAI_MODEL||'gpt-6-luna';
const aiHits=new Map();

const app=express();
const PORT=process.env.PORT||3000;
const JWT_SECRET=process.env.JWT_SECRET||'change-this-in-production';
if(!process.env.JWT_SECRET&&process.env.NODE_ENV==='production'){console.error('JWT_SECRET manquant : définis-le dans les variables Railway.');process.exit(1);}
const ORBE_ORIGIN=process.env.ORBE_ORIGIN||'';
const DB_PATH=process.env.DB_PATH||path.join(__dirname,'orbe.db');
try{fs.mkdirSync(path.dirname(DB_PATH),{recursive:true});}catch{}
const db=new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT UNIQUE NOT NULL,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,bio TEXT DEFAULT '',avatar TEXT DEFAULT '',created_at INTEGER NOT NULL);\nCREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,sender_id INTEGER NOT NULL,receiver_id INTEGER NOT NULL,text TEXT NOT NULL,created_at INTEGER NOT NULL,FOREIGN KEY(sender_id) REFERENCES users(id),FOREIGN KEY(receiver_id) REFERENCES users(id));\nCREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id,receiver_id,created_at);`);
app.use(cors(ORBE_ORIGIN?{origin:ORBE_ORIGIN}:{}));
app.use(express.json({limit:'2mb'}));
app.disable('x-powered-by');
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','SAMEORIGIN');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('Permissions-Policy','camera=(),microphone=(),geolocation=()');next()});
function safeUser(u){return {id:u.id,username:u.username,bio:u.bio||'',avatar:u.avatar||''};}
function auth(req,res,next){try{const h=req.headers.authorization||''; if(!h.startsWith('Bearer '))return res.status(401).json({error:'auth'}); req.user=jwt.verify(h.slice(7),JWT_SECRET); next();}catch{return res.status(401).json({error:'auth'});}}

app.get('/health',(req,res)=>res.json({ok:true,service:'orbe',ai:Boolean(OPENAI_API_KEY)}));
app.post('/api/ai/chat',auth,async(req,res)=>{
  const now=Date.now(), key=String(req.user.id), recent=aiHits.get(key)||[];
  const kept=recent.filter(t=>now-t<60000); if(kept.length>=20)return res.status(429).json({error:'Trop de demandes. Réessaie dans une minute.'});
  kept.push(now); aiHits.set(key,kept);
  if(!OPENAI_API_KEY)return res.status(503).json({error:'Orbe IA n’est pas encore configuré sur ce serveur.'});
  const messages=Array.isArray(req.body?.messages)?req.body.messages.slice(-12).map(m=>({role:m.role==='assistant'?'assistant':'user',content:String(m.content||'').slice(0,1200)})).filter(m=>m.content):[];
  if(!messages.length)return res.status(400).json({error:'Message manquant.'});
  try{
    const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${OPENAI_API_KEY}`},body:JSON.stringify({model:OPENAI_MODEL,instructions:`Tu es Orbe IA, le copilote d’un réseau social destiné notamment aux jeunes. Réponds en français, avec un ton chaleureux, clair et court. Aide à découvrir des centres d’intérêt, lancer des discussions, imaginer des missions de groupe et utiliser Orbe positivement. Ne révèle jamais de données privées sur les membres et n’invente jamais de profil. Ne demande jamais mot de passe, adresse, établissement scolaire, numéro de téléphone, localisation précise ou autre donnée sensible. Encourage les activités en groupe et les lieux publics quand une rencontre réelle est évoquée. Ne prétends pas être humain.`,input:messages,max_output_tokens:500})});
    const data=await r.json(); if(!r.ok)return res.status(502).json({error:'Le service IA est momentanément indisponible.'});
    const text=data.output_text||((data.output||[]).flatMap(x=>x.content||[]).map(x=>x.text||'').filter(Boolean).join('\n'))||'Je n’ai pas réussi à formuler une réponse.';
    res.json({text});
  }catch(e){res.status(502).json({error:'Impossible de contacter Orbe IA.'});}
});

app.post('/api/signup',(req,res)=>{const {email,username,password,bio='',avatar=''}=req.body||{}; if(!email||!username||!password||password.length<8)return res.status(400).json({error:'Champs invalides'}); try{const hash=bcrypt.hashSync(password,12);const info=db.prepare('INSERT INTO users(email,username,password_hash,bio,avatar,created_at) VALUES(?,?,?,?,?,?)').run(email.toLowerCase(),username.toLowerCase(),hash,String(bio).slice(0,120),String(avatar).slice(0,500000),Date.now());const u=db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);const token=jwt.sign({id:u.id},JWT_SECRET,{expiresIn:'30d'});res.json({token,user:safeUser(u)});}catch(e){res.status(400).json({error:'E-mail ou pseudo déjà utilisé'});}});
app.post('/api/login',(req,res)=>{const {login,password}=req.body||{};const u=db.prepare('SELECT * FROM users WHERE email=? OR username=?').get(String(login||'').toLowerCase(),String(login||'').replace(/^@/,'').toLowerCase());if(!u||!bcrypt.compareSync(password||'',u.password_hash))return res.status(401).json({error:'Identifiants incorrects'});res.json({token:jwt.sign({id:u.id},JWT_SECRET,{expiresIn:'30d'}),user:safeUser(u)});});
app.get('/api/me',auth,(req,res)=>{const u=db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);res.json({user:safeUser(u)});});
app.get('/api/users/search',auth,(req,res)=>{const q=String(req.query.q||'').trim().toLowerCase();let rows=q?db.prepare("SELECT id,username,bio,avatar FROM users WHERE id<>? AND (username LIKE ? OR bio LIKE ?) ORDER BY username LIMIT 50").all(req.user.id,`%${q}%`,`%${q}%`):db.prepare('SELECT id,username,bio,avatar FROM users WHERE id<>? ORDER BY created_at DESC LIMIT 50').all(req.user.id);res.json({users:rows});});
app.get('/api/messages/:userId',auth,(req,res)=>{const id=Number(req.params.userId);const rows=db.prepare('SELECT id,sender_id AS senderId,receiver_id AS receiverId,text,created_at AS createdAt FROM messages WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?) ORDER BY created_at ASC LIMIT 500').all(req.user.id,id,id,req.user.id);res.json({messages:rows});});
app.post('/api/messages/:userId',auth,(req,res)=>{const id=Number(req.params.userId);const text=String(req.body?.text||'').trim();if(!text||text.length>500)return res.status(400).json({error:'Message invalide'});const exists=db.prepare('SELECT id FROM users WHERE id=?').get(id);if(!exists)return res.status(404).json({error:'Utilisateur introuvable'});const info=db.prepare('INSERT INTO messages(sender_id,receiver_id,text,created_at) VALUES(?,?,?,?)').run(req.user.id,id,text,Date.now());res.json({id:info.lastInsertRowid});});
app.get('/api/conversations',auth,(req,res)=>{const rows=db.prepare(`SELECT u.id,u.username,u.bio,u.avatar, m.text,m.created_at AS createdAt FROM users u JOIN messages m ON (m.sender_id=u.id AND m.receiver_id=?) OR (m.receiver_id=u.id AND m.sender_id=?) WHERE m.id IN (SELECT MAX(id) FROM messages WHERE sender_id=? OR receiver_id=? GROUP BY CASE WHEN sender_id=? THEN receiver_id ELSE sender_id END) ORDER BY m.created_at DESC`).all(req.user.id,req.user.id,req.user.id,req.user.id,req.user.id);res.json({conversations:rows});});
const PUBLIC_DIR=path.join(__dirname,'public');
app.use(express.static(PUBLIC_DIR));
app.get('*',(req,res)=>res.sendFile(path.join(PUBLIC_DIR,'index.html')));
app.listen(PORT,'0.0.0.0',()=>console.log(`Orbe running on http://localhost:${PORT}`));
