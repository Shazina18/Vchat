const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Pool } = require('pg');

process.on('uncaughtException', err => console.error('UNCAUGHT:', err));
process.on('unhandledRejection', err => console.error('UNHANDLED:', err));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        phone TEXT,
        "profilePic" TEXT,
        "registeredAt" TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        sender TEXT NOT NULL,
        text TEXT,
        to_user TEXT,
        room TEXT,
        file TEXT,
        "isPrivate" INTEGER DEFAULT 0,
        type TEXT DEFAULT 'message',
        "callType" TEXT,
        "callFrom" TEXT,
        "callTo" TEXT,
        duration INTEGER DEFAULT 0,
        "callStatus" TEXT,
        timestamp BIGINT,
        time TEXT,
        "deletedForEveryone" INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room);
      CREATE INDEX IF NOT EXISTS idx_messages_private ON messages(to_user, sender);
    `);
    console.log('Database tables ready');
}
initDB().catch(err => { console.error('DB init failed:', err); process.exit(1); });

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
app.use(express.static('public'));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(session({
    secret: 'vchat-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

async function findUserByUsername(username) {
    const r = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    return r.rows[0] || null;
}

async function findUserByPhone(phone) {
    const r = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    return r.rows[0] || null;
}

function formatPhone(phone) {
    return phone.replace(/[^\d+]/g, '');
}

async function saveMessage(msg) {
    await pool.query(`INSERT INTO messages (id, sender, text, to_user, room, file, "isPrivate", type, "callType", "callFrom", "callTo", duration, "callStatus", timestamp, time)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
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
        await pool.query('INSERT INTO users (id, username, password, phone) VALUES ($1,$2,$3,$4)',
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
    
    req.session.user = { id: user.id, username: user.username };
    res.json({ success: true, username: user.username, phone: user.phone || null });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/user', (req, res) => {
    if (req.session.user) res.json({ loggedIn: true, user: req.session.user });
    else res.json({ loggedIn: false });
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
    
    await pool.query('UPDATE users SET username = $1 WHERE id = $2', [newUsername.trim(), user.id]);
    if (newPassword && newPassword.length >= 4) {
        const hashed = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, user.id]);
    }
    res.json({ success: true, message: 'Profile updated!' });
});

app.get('/api/users', async (req, res) => {
    const r = await pool.query('SELECT id, username, phone FROM users');
    const users = r.rows.map(u => ({ id: u.id, username: u.username, hasPhone: !!u.phone }));
    res.json(users);
});

app.get('/api/my-phone', async (req, res) => {
    if (!req.session.user) return res.json({ phone: null });
    const user = await findUserByUsername(req.session.user.username);
    res.json({ phone: user ? user.phone : null });
});

app.post('/api/match-phones', async (req, res) => {
    const { phones } = req.body;
    if (!phones || !Array.isArray(phones)) return res.json({ matches: {} });
    const r = await pool.query('SELECT phone, username FROM users WHERE phone IS NOT NULL');
    const matches = {};
    phones.forEach(suffix => {
        const clean = suffix.replace(/[^\d]/g, '');
        if (clean.length < 6) return;
        const user = r.rows.find(u => u.phone && u.phone.replace(/[^\d]/g, '').endsWith(clean));
        if (user) matches[suffix] = user.username;
    });
    res.json({ matches });
});

app.get('/api/messages', async (req, res) => {
    const r = await pool.query('SELECT * FROM messages ORDER BY timestamp');
    res.json(r.rows);
});

app.get('/api/private-messages/:user', async (req, res) => {
    const currentUser = req.session.user ? req.session.user.username : req.params.user;
    const otherUser = req.params.user;
    const r = await pool.query(`SELECT * FROM messages WHERE "isPrivate" = 1 AND (
      (sender = $1 AND to_user = $2) OR (sender = $2 AND to_user = $1)
    ) ORDER BY timestamp`, [currentUser, otherUser]);
    res.json(r.rows);
});

app.get('/api/call-history', async (req, res) => {
    const currentUser = req.session.user ? req.session.user.username : null;
    if (!currentUser) return res.status(401).json({ error: 'Not logged in' });
    const r = await pool.query(`SELECT * FROM messages WHERE type = 'call' AND ("callFrom" = $1 OR "callTo" = $1) ORDER BY timestamp DESC LIMIT 50`, [currentUser]);
    res.json(r.rows);
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
            await pool.query('UPDATE users SET "profilePic" = $1 WHERE id = $2', [req.file.filename, user.id]);
            res.json({ success: true, filename: req.file.filename });
        } else res.status(400).json({ success: false, message: 'User not found' });
    } else res.status(400).json({ success: false, message: 'Upload failed' });
});

app.get('/api/profile-pic/:username', async (req, res) => {
    const user = await findUserByUsername(req.params.username);
    if (user && user.profilePic) res.json({ profilePic: user.profilePic });
    else res.json({ profilePic: null });
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
        const r = await pool.query('SELECT * FROM messages WHERE room = $1 AND "isPrivate" = 0 ORDER BY timestamp DESC LIMIT 100', [newRoom]);
        const roomMessages = r.rows.reverse();
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
            let msg = data.msgId ? (await pool.query('SELECT * FROM messages WHERE id = $1', [data.msgId])).rows[0] : null;
            if (!msg) {
                msg = (await pool.query('SELECT * FROM messages WHERE sender = $1 AND room = $2 ORDER BY timestamp DESC LIMIT 1', [data.sender, targetRoom])).rows[0];
            }
            if (msg) {
                await pool.query('UPDATE messages SET "deletedForEveryone" = 1 WHERE id = $1', [msg.id]);
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
        await pool.query('UPDATE messages SET "callStatus" = $1, duration = $2 WHERE id = $3', [data.status || 'ended', data.duration || 0, data.callId]);
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
    console.log('Data persisted in PostgreSQL');
});
