const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";
const db = new Database(process.env.DB_PATH || path.join(__dirname, "nova.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  media_url TEXT,
  media_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS likes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, post_id)
);
CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(follower_id, following_id),
  CHECK(follower_id != following_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

app.set("trust proxy", isProd ? 1 : 0);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(session({
  name: "nova.sid",
  secret: process.env.SESSION_SECRET || "dev-only-change-this-secret-before-deploying",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: isProd, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, "public")));
app.use("/api/", rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));

const userFields = "id, name, username, bio, created_at";
function publicUser(row) {
  return row ? { id: row.id, name: row.name, username: row.username, bio: row.bio, createdAt: row.created_at } : null;
}
function auth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Bu işlem için giriş yapmalısın." });
  next();
}
function cleanText(value, max) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }

app.get("/api/health", (req, res) => res.json({ ok: true, service: "Nova" }));
app.get("/api/me", (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const row = db.prepare(`SELECT ${userFields} FROM users WHERE id = ?`).get(req.session.userId);
  res.json({ user: publicUser(row) });
});

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 25, message: { error: "Çok fazla deneme yaptın. Biraz sonra tekrar dene." } });
app.post("/api/register", authLimiter, async (req, res) => {
  const name = cleanText(req.body.name, 40);
  const username = cleanText(req.body.username, 24).replace(/^@/, "");
  const email = cleanText(req.body.email, 120).toLowerCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (name.length < 2) return res.status(400).json({ error: "Adın en az 2 karakter olmalı." });
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: "Kullanıcı adı 3-24 karakter; harf, sayı ve _ içerebilir." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Geçerli bir e-posta yaz." });
  if (password.length < 8 || password.length > 100) return res.status(400).json({ error: "Şifre 8-100 karakter olmalı." });
  const hash = await bcrypt.hash(password, 12);
  try {
    const info = db.prepare("INSERT INTO users (name, username, email, password_hash) VALUES (?, ?, ?, ?)").run(name, username, email, hash);
    req.session.userId = info.lastInsertRowid;
    res.status(201).json({ user: publicUser(db.prepare(`SELECT ${userFields} FROM users WHERE id = ?`).get(info.lastInsertRowid)) });
  } catch (e) {
    if (String(e.code).includes("SQLITE_CONSTRAINT")) return res.status(409).json({ error: "Bu e-posta veya kullanıcı adı zaten kullanılıyor." });
    console.error(e); res.status(500).json({ error: "Kayıt sırasında bir hata oluştu." });
  }
});
app.post("/api/login", authLimiter, async (req, res) => {
  const email = cleanText(req.body.email, 120).toLowerCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!row || !(await bcrypt.compare(password, row.password_hash))) return res.status(401).json({ error: "E-posta veya şifre hatalı." });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "Giriş yapılamadı." });
    req.session.userId = row.id;
    res.json({ user: publicUser(row) });
  });
});
app.post("/api/logout", (req, res) => req.session.destroy(() => {
  res.clearCookie("nova.sid", { httpOnly: true, sameSite: "lax", secure: isProd });
  res.json({ ok: true });
}));

app.get("/api/users", (req, res) => {
  const q = cleanText(req.query.q, 80);
  const rows = q
    ? db.prepare(`SELECT ${userFields} FROM users WHERE name LIKE ? OR username LIKE ? ORDER BY created_at DESC LIMIT 30`).all(`%${q}%`, `%${q}%`)
    : db.prepare(`SELECT ${userFields} FROM users ORDER BY created_at DESC LIMIT 30`).all();
  res.json({ users: rows.map(publicUser) });
});
app.patch("/api/profile", auth, (req, res) => {
  const name = cleanText(req.body.name, 40);
  const username = cleanText(req.body.username, 24).replace(/^@/, "");
  const bio = cleanText(req.body.bio, 160);
  if (name.length < 2) return res.status(400).json({ error: "Adın en az 2 karakter olmalı." });
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: "Kullanıcı adı 3-24 karakter; harf, sayı ve _ içerebilir." });
  try {
    db.prepare("UPDATE users SET name = ?, username = ?, bio = ? WHERE id = ?").run(name, username, bio, req.session.userId);
    res.json({ user: publicUser(db.prepare(`SELECT ${userFields} FROM users WHERE id = ?`).get(req.session.userId)) });
  } catch (e) {
    if (String(e.code).includes("SQLITE_CONSTRAINT")) return res.status(409).json({ error: "Bu kullanıcı adı zaten kullanılıyor." });
    res.status(500).json({ error: "Profil güncellenemedi." });
  }
});

app.get("/api/posts", (req, res) => {
  const q = cleanText(req.query.q, 100);
  const rows = q ? db.prepare(`
    SELECT p.id,p.user_id,p.text,p.media_url,p.media_type,p.created_at,u.name,u.username,
    (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS likes,
    (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.text LIKE ? OR u.name LIKE ? OR u.username LIKE ?
    ORDER BY p.id DESC LIMIT 100
  `).all(req.session.userId || 0, `%${q}%`, `%${q}%`, `%${q}%`) : db.prepare(`
    SELECT p.id,p.user_id,p.text,p.media_url,p.media_type,p.created_at,u.name,u.username,
    (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS likes,
    (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked
    FROM posts p JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT 100
  `).all(req.session.userId || 0);
  res.json({ posts: rows.map(p => ({ id:p.id,userId:p.user_id,text:p.text,mediaUrl:p.media_url,mediaType:p.media_type,createdAt:p.created_at,user:{id:p.user_id,name:p.name,username:p.username},likes:p.likes,liked:!!p.liked })) });
});
app.post("/api/posts", auth, (req, res) => {
  const text = cleanText(req.body.text, 1000);
  const mediaUrl = cleanText(req.body.mediaUrl, 500);
  const mediaType = ["image","video"].includes(req.body.mediaType) ? req.body.mediaType : null;
  if (!text && !mediaUrl) return res.status(400).json({ error: "Bir yazı yaz veya medya bağlantısı ekle." });
  if (mediaUrl && !/^https?:\/\//i.test(mediaUrl)) return res.status(400).json({ error: "Medya şimdilik herkese açık bir http(s) bağlantısı olmalı." });
  const info = db.prepare("INSERT INTO posts (user_id,text,media_url,media_type) VALUES (?,?,?,?)").run(req.session.userId,text,mediaUrl||null,mediaType);
  res.status(201).json({ id: info.lastInsertRowid });
});
app.post("/api/posts/:id/like", auth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) return res.status(400).json({ error: "Geçersiz gönderi." });
  const exists = db.prepare("SELECT id FROM posts WHERE id=?").get(id);
  if (!exists) return res.status(404).json({ error: "Gönderi bulunamadı." });
  const liked = db.prepare("SELECT 1 FROM likes WHERE user_id=? AND post_id=?").get(req.session.userId,id);
  if (liked) db.prepare("DELETE FROM likes WHERE user_id=? AND post_id=?").run(req.session.userId,id);
  else db.prepare("INSERT INTO likes (user_id,post_id) VALUES (?,?)").run(req.session.userId,id);
  res.json({ liked: !liked });
});
app.delete("/api/posts/:id", auth, (req, res) => {
  const result = db.prepare("DELETE FROM posts WHERE id=? AND user_id=?").run(Number(req.params.id),req.session.userId);
  if (!result.changes) return res.status(404).json({ error: "Gönderi bulunamadı veya sana ait değil." });
  res.json({ ok: true });
});
app.post("/api/follow/:id", auth, (req, res) => {
  const target = Number(req.params.id);
  if (target === req.session.userId) return res.status(400).json({ error: "Kendini takip edemezsin." });
  if (!db.prepare("SELECT id FROM users WHERE id=?").get(target)) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
  const exists = db.prepare("SELECT 1 FROM follows WHERE follower_id=? AND following_id=?").get(req.session.userId,target);
  if (exists) db.prepare("DELETE FROM follows WHERE follower_id=? AND following_id=?").run(req.session.userId,target);
  else db.prepare("INSERT INTO follows (follower_id,following_id) VALUES (?,?)").run(req.session.userId,target);
  res.json({ following: !exists });
});
app.get("/api/follows", auth, (req,res) => {
  res.json({ following: db.prepare("SELECT following_id AS id FROM follows WHERE follower_id=?").all(req.session.userId).map(x=>x.id) });
});
app.get("/api/messages/:userId", auth, (req,res) => {
  const other = Number(req.params.userId);
  if (!db.prepare("SELECT id FROM users WHERE id=?").get(other)) return res.status(404).json({error:"Kullanıcı bulunamadı."});
  const messages = db.prepare(`SELECT id,sender_id,receiver_id,text,created_at FROM messages
    WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)
    ORDER BY id ASC LIMIT 300`).all(req.session.userId,other,other,req.session.userId);
  res.json({messages:messages.map(m=>({id:m.id,from:m.sender_id,to:m.receiver_id,text:m.text,createdAt:m.created_at}))});
});
app.post("/api/messages/:userId", auth, (req,res) => {
  const other=Number(req.params.userId), text=cleanText(req.body.text,1000);
  if(other===req.session.userId) return res.status(400).json({error:"Kendine mesaj gönderemezsin."});
  if(!text) return res.status(400).json({error:"Mesaj boş olamaz."});
  if(!db.prepare("SELECT id FROM users WHERE id=?").get(other)) return res.status(404).json({error:"Kullanıcı bulunamadı."});
  const info=db.prepare("INSERT INTO messages (sender_id,receiver_id,text) VALUES (?,?,?)").run(req.session.userId,other,text);
  res.status(201).json({id:info.lastInsertRowid});
});

app.get("*", (req,res) => res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT, "0.0.0.0", () => console.log(`Nova çalışıyor: http://localhost:${PORT}`));
