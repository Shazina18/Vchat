const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const initSqlJs = require('sql.js');

process.on('uncaughtException', err => console.error('UNCAUGHT:', err));
process.on('unhandledRejection', err => console.error('UNHANDLED:', err));

// ── Dual Database: PostgreSQL (Render) or SQLite (local) ──
const USE_PG = !!process.env.DATABASE_URL;
let dbQuery, pgPool;

if (USE_PG) {
    const { Pool } = require('pg');
    pgPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    dbQuery = async (sql, params) => {
        try {
            // Convert ? to $1,$2,... for PostgreSQL
            let idx = 0;
            const pgSql = sql.replace(/\?/g, () => '$' + (++idx));
            const isSelect = /^\s*(SELECT|WITH)/i.test(pgSql.trim());
            const r = await pgPool.query(pgSql, params || []);
            return isSelect ? r.rows : null;
        } catch (e) { console.error('DB error:', e.message); return []; }
    };
    // Initialize PostgreSQL schema
    (async () => {
        try {
            await pgPool.query(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, phone TEXT, "profilePic" TEXT, role TEXT DEFAULT 'user', "registeredAt" TIMESTAMP DEFAULT NOW())`);
            await pgPool.query(`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, sender TEXT NOT NULL, text TEXT, to_user TEXT, room TEXT, file TEXT, "isPrivate" INTEGER DEFAULT 0, type TEXT DEFAULT 'message', "callType" TEXT, "callFrom" TEXT, "callTo" TEXT, duration INTEGER DEFAULT 0, "callStatus" TEXT, timestamp BIGINT, time TEXT, "deletedForEveryone" INTEGER DEFAULT 0)`);
            await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room)`);
            await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_messages_private ON messages(to_user, sender)`);
            await pgPool.query(`CREATE TABLE IF NOT EXISTS contacts (id SERIAL PRIMARY KEY, owner TEXT NOT NULL, contact TEXT NOT NULL, "addedAt" TIMESTAMP DEFAULT NOW(), UNIQUE(owner, contact))`);
            await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner)`);
            try { await pgPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user'`); } catch (_) {}
            console.log('PostgreSQL schema ready');
        } catch (e) { console.error('PostgreSQL init error:', e.message); }
    })();
} else {
    const DB_PATH = path.join(__dirname, 'vchat.db');
    let sqliteDb;
    dbQuery = (sql, params) => {
        if (!sqliteDb) return [];
        const isSelect = /^\s*(SELECT|WITH|PRAGMA)/i.test(sql.trim());
        try {
            if (isSelect) {
                const stmt = sqliteDb.prepare(sql);
                if (params && params.length > 0) stmt.bind(params);
                const rows = []; while (stmt.step()) rows.push(stmt.getAsObject());
                stmt.free(); return rows;
            } else {
                sqliteDb.run(sql, params || []); return null;
            }
        } catch (e) { console.error('DB error:', e.message); return isSelect ? [] : null; }
    };
    (async () => {
        const SQL = await initSqlJs();
        let data = null;
        if (fs.existsSync(DB_PATH)) data = new Uint8Array(fs.readFileSync(DB_PATH));
        sqliteDb = new SQL.Database(data || undefined);
        // Create tables + indices
        sqliteDb.run("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, phone TEXT, profilePic TEXT, role TEXT DEFAULT 'user', registeredAt TEXT DEFAULT (datetime('now')))");
        sqliteDb.run("CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, sender TEXT NOT NULL, text TEXT, to_user TEXT, room TEXT, file TEXT, isPrivate INTEGER DEFAULT 0, type TEXT DEFAULT 'message', callType TEXT, callFrom TEXT, callTo TEXT, duration INTEGER DEFAULT 0, callStatus TEXT, timestamp BIGINT, time TEXT, deletedForEveryone INTEGER DEFAULT 0)");
        sqliteDb.run("CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room)");
        sqliteDb.run("CREATE INDEX IF NOT EXISTS idx_messages_private ON messages(to_user, sender)");
        sqliteDb.run("CREATE TABLE IF NOT EXISTS contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, contact TEXT NOT NULL, addedAt TEXT DEFAULT (datetime('now')), UNIQUE(owner, contact))");
        sqliteDb.run("CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner)");
        try { sqliteDb.run("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'"); } catch (_) {}
        saveDb();
        console.log('SQLite database ready');
    })().catch(err => { console.error('DB init failed:', err); process.exit(1); });
    function saveDb() {
        if (!sqliteDb) return;
        try { fs.writeFileSync(DB_PATH, Buffer.from(sqliteDb.export())); } catch (e) { console.error('Save DB error:', e.message); }
    }
    setInterval(saveDb, 5000);
}

let twilioClient = null;
try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (accountSid && authToken) {
        twilioClient = require('twilio')(accountSid, authToken);
        console.log('Twilio SMS enabled');
    } else {
        console.log('Twilio not configured - OTPs in app UI');
    }
} catch (e) {
    console.log('Twilio not installed - OTPs in app UI');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const otpStore = new Map();

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const isProfilePic = req.route && req.route.path === '/upload-profilepic';
        cb(null, (isProfilePic ? 'p-' : '') + Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json());
app.use(express.static('public', {
    maxAge: 0,
    etag: false,
    setHeaders: function(res, path) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
}));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(session({
    secret: 'vchat-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

async function findUserByUsername(username) {
    const r = await dbQuery('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [username]);
    return r[0] || null;
}

async function findUserByPhone(phone) {
    const r = await dbQuery('SELECT * FROM users WHERE phone = ?', [phone]);
    return r[0] || null;
}

function formatPhone(phone) {
    return phone.replace(/[^\d+]/g, '');
}

async function saveMessage(msg) {
    await dbQuery(`INSERT INTO messages (id, sender, text, to_user, room, file, isPrivate, type, callType, callFrom, callTo, duration, callStatus, timestamp, time)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [msg.id, msg.sender, msg.text, msg.to_user, msg.room, msg.file, msg.isPrivate, msg.type, msg.callType, msg.callFrom, msg.callTo, msg.duration, msg.callStatus, msg.timestamp, msg.time]);
}

app.post('/api/send-otp', (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: 'Phone number required' });
    const formattedPhone = formatPhone(phone);
    if (formattedPhone.length < 10) return res.status(400).json({ success: false, message: 'Invalid phone number' });
    
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000;
    otpStore.set(formattedPhone, { otp, expiresAt, attempts: 0 });
    
    if (twilioClient) {
        twilioClient.messages.create({
            body: `Your Vchat code: ${otp}`,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: formattedPhone
        }).then(() => {
            res.json({ success: true, message: 'OTP sent!' });
        }).catch(err => {
            console.error('Twilio error:', err.message);
            res.json({ success: true, message: 'SMS failed. OTP below.', otp: otp });
        });
    } else {
        console.log('OTP for', formattedPhone, ':', otp);
        res.json({ success: true, message: 'OTP sent!', otp: otp });
    }
});

app.post('/api/verify-otp', (req, res) => {
    const { phone, otp } = req.body;
    if (!phone || !otp) return res.status(400).json({ success: false, message: 'Phone and OTP required' });
    const formattedPhone = formatPhone(phone);
    const stored = otpStore.get(formattedPhone);
    if (!stored) return res.status(400).json({ success: false, message: 'No OTP sent' });
    if (Date.now() > stored.expiresAt) { otpStore.delete(formattedPhone); return res.status(400).json({ success: false, message: 'OTP expired' }); }
    stored.attempts++;
    if (stored.attempts > 5) { otpStore.delete(formattedPhone); return res.status(400).json({ success: false, message: 'Too many attempts' }); }
    if (stored.otp !== otp) return res.status(400).json({ success: false, message: 'Invalid OTP' });
    otpStore.delete(formattedPhone);
    res.json({ success: true, message: 'Phone verified!' });
});

app.post('/api/register', async (req, res) => {
    const { username, password, phone } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required' });
    if (username.length < 3 || username.length > 20) return res.status(400).json({ success: false, message: 'Username 3-20 characters' });
    if (password.length < 4) return res.status(400).json({ success: false, message: 'Password min 4 characters' });
    
    const existing = await findUserByUsername(username);
    if (existing) return res.status(400).json({ success: false, message: 'Username exists' });
    
    if (phone) {
        const formattedPhone = formatPhone(phone);
        const existingPhone = await findUserByPhone(formattedPhone);
        if (existingPhone) return res.status(400).json({ success: false, message: 'Phone already registered' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    try {
        await dbQuery('INSERT INTO users (id, username, password, phone) VALUES (?,?,?,?)',
          [Date.now().toString(), username.trim(), hashedPassword, phone ? formatPhone(phone) : null]);
        res.json({ success: true, message: 'Registration successful!' });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ success: false, message: 'Registration failed' });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required' });
    
    let user = await findUserByUsername(username);
    if (!user) {
        const formattedPhone = formatPhone(username);
        user = await findUserByPhone(formattedPhone);
    }
    if (!user) return res.status(400).json({ success: false, message: 'Invalid username/phone or password' });
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ success: false, message: 'Invalid username/phone or password' });
    
    req.session.user = { id: user.id, username: user.username, role: user.role || 'user' };
    res.json({ success: true, username: user.username, phone: user.phone || null, role: user.role || 'user' });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/user', async (req, res) => {
    if (!req.session.user) return res.json({ loggedIn: false });
    const user = await findUserByUsername(req.session.user.username);
    res.json({ loggedIn: true, user: { id: user.id, username: user.username, role: user.role || 'user' } });
});

app.post('/api/update-profile', async (req, res) => {
    const { currentUsername, currentPassword, newUsername, newPassword } = req.body;
    if (!currentUsername || !currentPassword || !newUsername) return res.status(400).json({ success: false, message: 'All fields required' });
    
    const user = await findUserByUsername(currentUsername);
    if (!user) return res.status(400).json({ success: false, message: 'User not found' });
    
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(400).json({ success: false, message: 'Current password incorrect' });
    
    if (newUsername.toLowerCase() !== currentUsername.toLowerCase()) {
        const existing = await findUserByUsername(newUsername);
        if (existing) return res.status(400).json({ success: false, message: 'Username exists' });
    }
    
    await dbQuery('UPDATE users SET username = ? WHERE id = ?', [newUsername.trim(), user.id]);
    if (newPassword && newPassword.length >= 4) {
        const hashed = await bcrypt.hash(newPassword, 10);
        await dbQuery('UPDATE users SET password = ? WHERE id = ?', [hashed, user.id]);
    }
    res.json({ success: true, message: 'Profile updated!' });
});

app.get('/api/users', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const userRow = (await dbQuery('SELECT role FROM users WHERE username = ?', [req.session.user.username]))[0];
    if (userRow && userRow.role === 'admin') {
        const users = await dbQuery('SELECT id, username, phone FROM users');
        return res.json(users.map(u => ({ id: u.id, username: u.username, hasPhone: !!u.phone })));
    }
    // Regular users: return only themselves
    res.json([{ id: req.session.user.id, username: req.session.user.username }]);
});

app.get('/api/user-check/:username', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const user = await findUserByUsername(req.params.username);
    res.json({ exists: !!user, username: user ? user.username : null });
});

app.get('/api/my-phone', async (req, res) => {
    if (!req.session.user) return res.json({ phone: null });
    const user = await findUserByUsername(req.session.user.username);
    res.json({ phone: user ? user.phone : null });
});

app.post('/api/match-phones', async (req, res) => {
    const { phones } = req.body;
    if (!phones || !Array.isArray(phones)) return res.json({ matches: {} });
    const allUsers = await dbQuery('SELECT phone, username FROM users WHERE phone IS NOT NULL');
    const matches = {};
    phones.forEach(suffix => {
        const clean = suffix.replace(/[^\d]/g, '');
        if (clean.length < 6) return;
        const user = allUsers.find(u => u.phone && u.phone.replace(/[^\d]/g, '').endsWith(clean));
        if (user) matches[suffix] = user.username;
    });
    res.json({ matches });
});

app.get('/api/private-messages/:user', async (req, res) => {
    const currentUser = req.session.user ? req.session.user.username : req.params.user;
    const otherUser = req.params.user;
    const messages = await dbQuery(`SELECT * FROM messages WHERE isPrivate = 1 AND (
      (sender = ? AND to_user = ?) OR (sender = ? AND to_user = ?)
    ) ORDER BY timestamp`, [currentUser, otherUser, otherUser, currentUser]);
    res.json(messages);
});

app.get('/api/call-history', async (req, res) => {
    const currentUser = req.session.user ? req.session.user.username : null;
    if (!currentUser) return res.status(401).json({ error: 'Not logged in' });
    const calls = await dbQuery(`SELECT * FROM messages WHERE type = 'call' AND (callFrom = ? OR callTo = ?) ORDER BY timestamp DESC LIMIT 50`, [currentUser, currentUser]);
    res.json(calls);
});

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (req.file) res.json({ success: true, filename: req.file.filename });
    else res.status(400).json({ success: false, message: 'Upload failed' });
});

app.post('/api/upload-profilepic', upload.single('file'), async (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false, message: 'Not logged in' });
    if (req.file) {
        const user = await findUserByUsername(req.session.user.username);
        if (user) {
            await dbQuery('UPDATE users SET profilePic = ? WHERE id = ?', [req.file.filename, user.id]);
            res.json({ success: true, filename: req.file.filename });
        } else res.status(400).json({ success: false, message: 'User not found' });
    } else res.status(400).json({ success: false, message: 'Upload failed' });
});

app.get('/api/profile-pic/:username', async (req, res) => {
    const user = await findUserByUsername(req.params.username);
    if (user && user.profilePic) res.json({ profilePic: user.profilePic });
    else res.json({ profilePic: null });
});

// ── Contacts API ──
app.get('/api/contacts', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const rows = await dbQuery('SELECT contact FROM contacts WHERE owner = ? ORDER BY contact', [req.session.user.username]);
    res.json(rows.map(c => c.contact));
});

app.post('/api/contacts/add', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const { contact } = req.body;
    if (!contact || contact === req.session.user.username) return res.status(400).json({ error: 'Invalid contact' });
    if (!findUserByUsername(contact)) return res.status(400).json({ error: 'User not found' });
    try {
        await dbQuery('INSERT INTO contacts (owner, contact) VALUES (?, ?)', [req.session.user.username, contact]);
        saveDb();
        res.json({ success: true });
    } catch (e) {
        if (e.message && e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Already in contacts' });
        res.status(500).json({ error: 'Failed to add contact' });
    }
});

app.post('/api/contacts/remove', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const { contact } = req.body;
    await dbQuery('DELETE FROM contacts WHERE owner = ? AND contact = ?', [req.session.user.username, contact]);
    saveDb();
    res.json({ success: true });
});

// ── Admin API ──
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'vchat-admin-2024';

app.post('/api/promote', async (req, res) => {
    const { username, secret } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Invalid secret' });
    const user = await findUserByUsername(username);
    if (!user) return res.status(400).json({ error: 'User not found' });
    await dbQuery('UPDATE users SET role = ? WHERE id = ?', ['admin', user.id]);
    saveDb();
    res.json({ success: true, message: username + ' is now admin' });
});

async function requireAdmin(req, res, next) {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    try {
        const rows = await dbQuery('SELECT role FROM users WHERE username = ?', [req.session.user.username]);
        if (rows.length === 0 || rows[0].role !== 'admin') return res.status(403).json({ error: 'Admin only' });
        next();
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
}

app.get('/api/admin/users', requireAdmin, async (req, res) => {
    const users = await dbQuery('SELECT id, username, phone, role, registeredAt FROM users ORDER BY username');
    res.json(users);
});

app.get('/api/admin/user/:username', requireAdmin, async (req, res) => {
    const user = await findUserByUsername(req.params.username);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const contacts = (await dbQuery('SELECT contact FROM contacts WHERE owner = ?', [user.username])).map(c => c.contact);
    const messages = await dbQuery('SELECT * FROM messages WHERE isPrivate = 1 AND (sender = ? OR to_user = ?) ORDER BY timestamp', [user.username, user.username]);
    const calls = await dbQuery("SELECT * FROM messages WHERE type = 'call' AND (callFrom = ? OR callTo = ?) ORDER BY timestamp DESC LIMIT 50", [user.username, user.username]);
    res.json({ user: { id: user.id, username: user.username, phone: user.phone, role: user.role, profilePic: user.profilePic, registeredAt: user.registeredAt }, contacts, messages, calls });
});

app.get('/api/admin/messages', requireAdmin, async (req, res) => {
    const msgs = await dbQuery('SELECT * FROM messages ORDER BY timestamp DESC LIMIT 500');
    res.json(msgs);
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    const userCount = (await dbQuery('SELECT COUNT(*) as cnt FROM users'))[0].cnt;
    const msgCount = (await dbQuery('SELECT COUNT(*) as cnt FROM messages'))[0].cnt;
    const callCount = (await dbQuery("SELECT COUNT(*) as cnt FROM messages WHERE type = 'call'"))[0].cnt;
    const onlineCount = onlineUsers.size;
    res.json({ userCount, msgCount, callCount, onlineCount });
});

app.get('/api/messages', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const currentUser = req.session.user.username;
    const msgs = await dbQuery('SELECT * FROM messages WHERE sender = ? OR to_user = ? ORDER BY timestamp DESC LIMIT 200', [currentUser, currentUser]);
    res.json(msgs);
});

const rooms = new Map();
const onlineUsers = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join', (data) => {
        const username = data.username;
        const room = data.room || 'general';
        socket.join(room);
        onlineUsers.set(socket.id, { username, room });
        if (!rooms.has(room)) rooms.set(room, new Set());
        rooms.get(room).add(socket.id);
        const roomUsers = Array.from(onlineUsers.entries()).filter(([, u]) => u.room === room).map(([id, u]) => [id, u.username]);
        io.to(room).emit('user joined', { id: socket.id, name: username, room });
        io.to(room).emit('update users', roomUsers);
    });

    socket.on('join room', async (data) => {
        const username = data.username;
        const newRoom = data.room;
        const user = onlineUsers.get(socket.id);
        if (user) {
            socket.leave(user.room);
            if (rooms.has(user.room)) rooms.get(user.room).delete(socket.id);
        }
        socket.join(newRoom);
        onlineUsers.set(socket.id, { username, room: newRoom });
        if (!rooms.has(newRoom)) rooms.set(newRoom, new Set());
        rooms.get(newRoom).add(socket.id);
        const roomUsers = Array.from(onlineUsers.entries()).filter(([, u]) => u.room === newRoom).map(([id, u]) => [id, u.username]);
        const roomMessages = (await dbQuery('SELECT * FROM messages WHERE room = ? AND isPrivate = 0 ORDER BY timestamp DESC LIMIT 100', [newRoom])).reverse();
        io.to(newRoom).emit('user joined', { id: socket.id, name: username, room: newRoom });
        io.to(newRoom).emit('update users', roomUsers);
        socket.emit('room joined', { room: newRoom, messages: roomMessages });
    });

    socket.on('typing', () => {
        const user = onlineUsers.get(socket.id);
        if (user) socket.to(user.room).emit('typing', { username: user.username });
    });

    socket.on('stop typing', () => {
        const user = onlineUsers.get(socket.id);
        if (user) socket.to(user.room).emit('stop typing');
    });

    socket.on('chat message', (data) => {
        const user = onlineUsers.get(socket.id);
        if (!user) return;
        const message = {
            id: Date.now().toString(),
            sender: data.sender,
            text: data.text,
            file: data.file || null,
            room: user.room,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            timestamp: Date.now(),
            isPrivate: 0,
            to_user: null,
            type: 'message',
            callType: null, callFrom: null, callTo: null, duration: 0, callStatus: null
        };
        saveMessage(message);
        socket.broadcast.to(user.room).emit('chat message', message);
        socket.emit('message delivered', { sender: data.sender, chatType: 'room' });
    });

    socket.on('message seen', (data) => {
        const user = onlineUsers.get(socket.id);
        if (!user) return;
        if (data.chatType === 'private') {
            onlineUsers.forEach((userData, socketId) => {
                if (userData.username === data.room) io.to(socketId).emit('message seen', { sender: data.sender, by: user.username });
            });
        } else {
            socket.broadcast.to(user.room).emit('message seen', { sender: data.sender, by: user.username });
        }
    });

    socket.on('message delivered', (data) => {
        const user = onlineUsers.get(socket.id);
        if (!user) return;
        if (data.chatType === 'private') {
            onlineUsers.forEach((userData, socketId) => {
                if (userData.username === data.room) io.to(socketId).emit('message delivered', { sender: data.sender, to: data.room });
            });
        } else {
            socket.broadcast.to(user.room).emit('message delivered', { sender: data.sender });
        }
    });

    socket.on('delete message', async (data) => {
        const user = onlineUsers.get(socket.id);
        if (!user) return;
        let targetRoom = data.chatType === 'private' ? user.room : data.room;
        if (data.type === 'everyone') {
            let msg = data.msgId ? (await dbQuery('SELECT * FROM messages WHERE id = ?', [data.msgId]))[0] : null;
            if (!msg) {
                msg = (await dbQuery('SELECT * FROM messages WHERE sender = ? AND room = ? ORDER BY timestamp DESC LIMIT 1', [data.sender, targetRoom]))[0];
            }
            if (msg) {
                await dbQuery('UPDATE messages SET deletedForEveryone = 1 WHERE id = ?', [msg.id]);
            }
            if (data.chatType === 'private') {
                onlineUsers.forEach((userData, socketId) => {
                    if (socketId !== socket.id && (userData.username === data.room || userData.username === user.username)) {
                        io.to(socketId).emit('delete message', data);
                    }
                });
            } else {
                socket.broadcast.to(user.room).emit('delete message', data);
            }
        } else {
            if (data.chatType === 'private') {
                onlineUsers.forEach((userData, socketId) => {
                    if (userData.username === data.room) io.to(socketId).emit('delete message', { sender: data.sender, time: data.time, type: 'me' });
                });
            } else {
                socket.broadcast.to(user.room).emit('delete message', { sender: data.sender, time: data.time, type: 'me' });
            }
        }
    });

    socket.on('private message', (data) => {
        const to = data.to;
        const from = onlineUsers.get(socket.id);
        if (!from) return;
        const msg = {
            id: Date.now().toString(),
            sender: from.username,
            text: data.message,
            to_user: to,
            room: 'private',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            timestamp: Date.now(),
            isPrivate: 1,
            file: null,
            type: 'message',
            callType: null, callFrom: null, callTo: null, duration: 0, callStatus: null
        };
        saveMessage(msg);
        let sent = false;
        onlineUsers.forEach((userData, socketId) => {
            if (userData.username === to) { io.to(socketId).emit('private message', msg); sent = true; }
        });
        if (sent) socket.emit('message delivered', { sender: from.username, to, chatType: 'private' });
    });

    socket.on('call request', (data) => {
        const user = onlineUsers.get(socket.id);
        if (!user) return;
        const msg = {
            id: Date.now().toString(), sender: user.username, text: null, to_user: data.to,
            room: 'private', file: null, isPrivate: 1,
            type: 'call', callType: data.callType, callFrom: user.username, callTo: data.to,
            duration: 0, callStatus: 'calling',
            timestamp: Date.now(), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        saveMessage(msg);
        onlineUsers.forEach((userData, socketId) => {
            if (userData.username === data.to) {
                io.to(socketId).emit('call request', { from: user.username, to: data.to, callType: data.callType, offer: data.offer, callId: msg.id });
            }
        });
    });

    socket.on('call ended', async (data) => {
        const user = onlineUsers.get(socket.id);
        if (!user || !data.callId) return;
        await dbQuery('UPDATE messages SET callStatus = ?, duration = ? WHERE id = ?', [data.status || 'ended', data.duration || 0, data.callId]);
        onlineUsers.forEach((userData, socketId) => {
            if (userData.username === (data.to || data.from)) io.to(socketId).emit('call ended', data);
        });
    });

    socket.on('call signaling', (data) => {
        onlineUsers.forEach((userData, socketId) => {
            if (userData.username === data.to) io.to(socketId).emit('call signaling', data);
        });
    });

    socket.on('disconnect', () => {
        const user = onlineUsers.get(socket.id);
        if (user) {
            if (rooms.has(user.room)) rooms.get(user.room).delete(socket.id);
            io.to(user.room).emit('user left', { id: socket.id, name: user.username });
        }
        onlineUsers.delete(socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('Server running on port ' + PORT);
    console.log('Data persisted in SQLite (vchat.db)');
});
