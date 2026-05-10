const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');

// Twilio (optional - falls back to console OTP for development)
let twilioClient = null;
try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (accountSid && authToken) {
        twilioClient = require('twilio')(accountSid, authToken);
        console.log('Twilio SMS enabled');
    } else {
        console.log('Twilio not configured - OTPs will appear in server logs');
    }
} catch (e) {
    console.log('Twilio not installed - OTPs will appear in server logs');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// In-memory OTP store
const otpStore = new Map();

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const isProfilePic = req.route && req.route.path === '/upload-profilepic';
        const prefix = isProfilePic ? 'p-' : '';
        cb(null, prefix + Date.now() + '-' + file.originalname);
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

function loadUsers() {
    if (!fs.existsSync(USERS_FILE)) return [];
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data || '[]');
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function loadMessages() {
    if (!fs.existsSync(MESSAGES_FILE)) return [];
    try {
        const data = fs.readFileSync(MESSAGES_FILE, 'utf8');
        return JSON.parse(data || '[]');
    } catch {
        return [];
    }
}

function saveMessages(messages) {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
}

function findUserByUsername(username) {
    const users = loadUsers();
    return users.find(u => u.username.toLowerCase() === username.toLowerCase());
}

function findUserByPhone(phone) {
    const users = loadUsers();
    return users.find(u => u.phone === phone);
}

function formatPhone(phone) {
    // Remove all non-digit characters except leading +
    return phone.replace(/[^\d+]/g, '');
}

// Send OTP
app.post('/api/send-otp', (req, res) => {
    const { phone } = req.body;
    if (!phone) {
        return res.status(400).json({ success: false, message: 'Phone number required' });
    }
    
    const formattedPhone = formatPhone(phone);
    if (formattedPhone.length < 10) {
        return res.status(400).json({ success: false, message: 'Invalid phone number' });
    }
    
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 min expiry
    
    otpStore.set(formattedPhone, { otp, expiresAt, attempts: 0 });
    
    // Send via Twilio or fallback to console
    if (twilioClient) {
        twilioClient.messages.create({
            body: `Your Vchat verification code is: ${otp}`,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: formattedPhone
        }).then(() => {
            console.log('OTP sent to', formattedPhone);
            res.json({ success: true, message: 'OTP sent!' });
        }).catch(err => {
            console.error('Twilio error:', err);
            res.status(500).json({ success: false, message: 'Failed to send OTP. Try again.' });
        });
    } else {
        console.log('\n========== OTP for', formattedPhone, '==========');
        console.log('Code:', otp);
        console.log('Expires:', new Date(expiresAt).toLocaleTimeString());
        console.log('========================================\n');
        res.json({ success: true, message: 'OTP sent! (check server logs)', otp: otp });
    }
});

// Verify OTP
app.post('/api/verify-otp', (req, res) => {
    const { phone, otp } = req.body;
    if (!phone || !otp) {
        return res.status(400).json({ success: false, message: 'Phone and OTP required' });
    }
    
    const formattedPhone = formatPhone(phone);
    const stored = otpStore.get(formattedPhone);
    
    if (!stored) {
        return res.status(400).json({ success: false, message: 'No OTP sent to this number' });
    }
    
    if (Date.now() > stored.expiresAt) {
        otpStore.delete(formattedPhone);
        return res.status(400).json({ success: false, message: 'OTP expired. Request a new one.' });
    }
    
    stored.attempts++;
    if (stored.attempts > 5) {
        otpStore.delete(formattedPhone);
        return res.status(400).json({ success: false, message: 'Too many attempts. Request a new OTP.' });
    }
    
    if (stored.otp !== otp) {
        return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }
    
    otpStore.delete(formattedPhone);
    res.json({ success: true, message: 'Phone verified!' });
});

// Register with phone
app.post('/api/register', async (req, res) => {
    const { username, password, phone } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required' });
    }
    if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ success: false, message: 'Username must be 3-20 characters' });
    }
    if (password.length < 4) {
        return res.status(400).json({ success: false, message: 'Password must be at least 4 characters' });
    }
    if (findUserByUsername(username)) {
        return res.status(400).json({ success: false, message: 'Username already exists' });
    }
    
    const users = loadUsers();
    
    // Check if phone is already used
    if (phone) {
        const formattedPhone = formatPhone(phone);
        if (findUserByPhone(formattedPhone)) {
            return res.status(400).json({ success: false, message: 'Phone number already registered' });
        }
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
        id: Date.now().toString(),
        username: username.trim(),
        password: hashedPassword,
        phone: phone ? formatPhone(phone) : null,
        registeredAt: new Date().toISOString()
    };
    users.push(newUser);
    saveUsers(users);
    res.json({ success: true, message: 'Registration successful!' });
});

// Login (supports username OR phone)
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required' });
    }
    
    let user = findUserByUsername(username);
    if (!user) {
        // Try phone login
        const formattedPhone = formatPhone(username);
        user = findUserByPhone(formattedPhone);
    }
    
    if (!user) {
        return res.status(400).json({ success: false, message: 'Invalid username/phone or password' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        return res.status(400).json({ success: false, message: 'Invalid username/phone or password' });
    }
    req.session.user = { id: user.id, username: user.username };
    res.json({ success: true, username: user.username, phone: user.phone || null });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/user', (req, res) => {
    if (req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

app.post('/api/update-profile', async (req, res) => {
    const { currentUsername, currentPassword, newUsername, newPassword } = req.body;
    
    if (!currentUsername || !currentPassword || !newUsername) {
        return res.status(400).json({ success: false, message: 'All fields required' });
    }
    
    const users = loadUsers();
    const userIndex = users.findIndex(u => u.username.toLowerCase() === currentUsername.toLowerCase());
    
    if (userIndex === -1) {
        return res.status(400).json({ success: false, message: 'User not found' });
    }
    
    const user = users[userIndex];
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    
    if (!isMatch) {
        return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }
    
    if (newUsername.toLowerCase() !== currentUsername.toLowerCase()) {
        const existingUser = users.find(u => u.username.toLowerCase() === newUsername.toLowerCase());
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Username already exists' });
        }
    }
    
    users[userIndex].username = newUsername.trim();
    
    if (newPassword && newPassword.length >= 4) {
        users[userIndex].password = await bcrypt.hash(newPassword, 10);
    }
    
    saveUsers(users);
    res.json({ success: true, message: 'Profile updated!' });
});

app.get('/api/users', (req, res) => {
    const users = loadUsers();
    // Never expose phone numbers or passwords
    res.json(users.map(u => ({ id: u.id, username: u.username })));
});

app.get('/api/my-phone', (req, res) => {
    if (!req.session.user) return res.json({ phone: null });
    const user = findUserByUsername(req.session.user.username);
    res.json({ phone: user ? user.phone : null });
});

app.get('/api/messages', (req, res) => {
    const messages = loadMessages();
    res.json(messages);
});

app.get('/api/private-messages/:user', (req, res) => {
    const currentUser = req.session.user ? req.session.user.username : req.params.user;
    const otherUser = req.params.user;
    const messages = loadMessages();
    const privateMessages = messages.filter(m => 
        m.isPrivate && 
        ((m.sender === currentUser && m.to === otherUser) || 
         (m.sender === otherUser && m.to === currentUser))
    );
    res.json(privateMessages);
});

app.get('/api/call-history', (req, res) => {
    const currentUser = req.session.user ? req.session.user.username : null;
    if (!currentUser) return res.status(401).json({ error: 'Not logged in' });
    
    const messages = loadMessages();
    const callHistory = messages.filter(m => 
        m.type === 'call' && 
        (m.from === currentUser || m.to === currentUser)
    ).slice(-50);
    res.json(callHistory);
});

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (req.file) {
        res.json({ success: true, filename: req.file.filename });
    } else {
        res.status(400).json({ success: false, message: 'Upload failed' });
    }
});

app.post('/api/upload-profilepic', upload.single('file'), (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Not logged in' });
    }
    if (req.file) {
        const users = loadUsers();
        const userIndex = users.findIndex(u => u.id === req.session.user.id);
        if (userIndex !== -1) {
            users[userIndex].profilePic = req.file.filename;
            saveUsers(users);
            res.json({ success: true, filename: req.file.filename });
        } else {
            res.status(400).json({ success: false, message: 'User not found' });
        }
    } else {
        res.status(400).json({ success: false, message: 'Upload failed' });
    }
});

app.get('/api/profile-pic/:username', (req, res) => {
    const username = req.params.username;
    const user = findUserByUsername(username);
    if (user && user.profilePic) {
        res.json({ profilePic: user.profilePic });
    } else {
        res.json({ profilePic: null });
    }
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
        
        if (!rooms.has(room)) {
            rooms.set(room, new Set());
        }
        rooms.get(room).add(socket.id);
        
        const roomUsers = Array.from(onlineUsers.entries())
            .filter(([, u]) => u.room === room)
            .map(([id, u]) => [id, u.username]);
        
        io.to(room).emit('user joined', { id: socket.id, name: username, room: room });
        io.to(room).emit('update users', roomUsers);
        console.log('User', username, 'joined room', room);
    });

    socket.on('join room', (data) => {
        const username = data.username;
        const newRoom = data.room;
        const user = onlineUsers.get(socket.id);
        
        if (user) {
            socket.leave(user.room);
            if (rooms.has(user.room)) {
                rooms.get(user.room).delete(socket.id);
            }
        }
        
        socket.join(newRoom);
        onlineUsers.set(socket.id, { username, room: newRoom });
        
        if (!rooms.has(newRoom)) {
            rooms.set(newRoom, new Set());
        }
        rooms.get(newRoom).add(socket.id);
        
        const roomUsers = Array.from(onlineUsers.entries())
            .filter(([, u]) => u.room === newRoom)
            .map(([id, u]) => [id, u.username]);
        
        const roomMessages = loadMessages().filter(m => m.room === newRoom).slice(-100);
        
        io.to(newRoom).emit('user joined', { id: socket.id, name: username, room: newRoom });
        io.to(newRoom).emit('update users', roomUsers);
        socket.emit('room joined', { room: newRoom, messages: roomMessages });
        console.log('User', username, 'switched to room', newRoom);
    });

    socket.on('typing', () => {
        const user = onlineUsers.get(socket.id);
        if (user) {
            socket.to(user.room).emit('typing', { username: user.username });
        }
    });

    socket.on('stop typing', () => {
        const user = onlineUsers.get(socket.id);
        if (user) {
            socket.to(user.room).emit('stop typing');
        }
    });

    socket.on('chat message', (data) => {
        const user = onlineUsers.get(socket.id);
        if (!user) return;
        
        const message = {
            id: Date.now().toString(),
            sender: data.sender,
            text: data.text,
            file: data.file,
            room: user.room,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            timestamp: Date.now()
        };
        
        const messages = loadMessages();
        messages.push(message);
        if (messages.length > 1000) messages.splice(0, messages.length - 1000);
        saveMessages(messages);
        
        socket.broadcast.to(user.room).emit('chat message', message);
        socket.emit('message delivered', { sender: data.sender, chatType: 'room' });
    });

    socket.on('message seen', (data) => {
        const user = onlineUsers.get(socket.id);
        if (!user) return;
        
        if (data.chatType === 'private') {
            onlineUsers.forEach((userData, socketId) => {
                if (userData.username === data.room) {
                    io.to(socketId).emit('message seen', { sender: data.sender, by: user.username });
                }
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
                if (userData.username === data.room) {
                    io.to(socketId).emit('message delivered', { sender: data.sender, to: data.room });
                }
            });
        } else {
            socket.broadcast.to(user.room).emit('message delivered', { sender: data.sender });
        }
    });

    socket.on('delete message', (data) => {
        console.log('Delete message received on server:', data);
        const user = onlineUsers.get(socket.id);
        if (!user) return;
        
        const messages = loadMessages();
        
        if (data.type === 'everyone') {
            let targetRoom = data.room;
            if (data.chatType === 'private') {
                targetRoom = user.room;
            }
            
            let msgIndex = -1;
            if (data.msgId) {
                msgIndex = messages.findIndex(m => m.id === data.msgId && m.room === targetRoom);
            }
            if (msgIndex === -1) {
                msgIndex = messages.findIndex(m => 
                    m.sender === data.sender && 
                    m.room === targetRoom &&
                    (m.time === data.time || (m.time && data.time && m.time.includes(data.time.split(' ').pop())))
                );
            }
            
            console.log('Message index:', msgIndex);
            if (msgIndex !== -1) {
                messages[msgIndex].deletedForEveryone = true;
                saveMessages(messages);
                console.log('Message marked as deleted in database');
            }
            
            if (data.chatType === 'private') {
                console.log('Sending delete to private chat participants');
                onlineUsers.forEach((userData, socketId) => {
                    if (socketId !== socket.id) {
                        if (userData.username === data.room || userData.username === user.username) {
                            io.to(socketId).emit('delete message', data);
                            console.log('Sent delete to:', userData.username);
                        }
                    }
                });
            } else {
                console.log('Sending delete to room:', user.room);
                socket.broadcast.to(user.room).emit('delete message', data);
            }
        } else if (data.type === 'me') {
            if (data.chatType === 'private') {
                onlineUsers.forEach((userData, socketId) => {
                    if (userData.username === data.room) {
                        io.to(socketId).emit('delete message', { sender: data.sender, time: data.time, type: 'me' });
                    }
                });
            } else {
                socket.broadcast.to(user.room).emit('delete message', { sender: data.sender, time: data.time, type: 'me' });
            }
        }
    });

    socket.on('private message', (data) => {
        const to = data.to;
        const messageText = data.message;
        const from = onlineUsers.get(socket.id);
        
        if (!from) return;
        
        const msg = {
            id: Date.now().toString(),
            sender: from.username,
            text: messageText,
            to: to,
            room: 'private',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            isPrivate: true
        };
        
        const messages = loadMessages();
        messages.push(msg);
        saveMessages(messages);
        
        let sent = false;
        onlineUsers.forEach((userData, socketId) => {
            if (userData.username === to) {
                io.to(socketId).emit('private message', msg);
                sent = true;
            }
        });
        
        if (sent) {
            socket.emit('message delivered', { sender: from.username, to: to, chatType: 'private' });
        }
    });

    socket.on('call request', (data) => {
        const user = onlineUsers.get(socket.id);
        if (!user) return;
        
        const callRecord = {
            id: Date.now().toString(),
            type: 'call',
            callType: data.callType,
            from: user.username,
            to: data.to,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            timestamp: Date.now(),
            status: 'calling'
        };
        
        const messages = loadMessages();
        messages.push(callRecord);
        saveMessages(messages);
        
        onlineUsers.forEach((userData, socketId) => {
            if (userData.username === data.to) {
                io.to(socketId).emit('call request', {
                    from: user.username,
                    to: data.to,
                    callType: data.callType,
                    offer: data.offer,
                    callId: callRecord.id
                });
            }
        });
    });

    socket.on('call ended', (data) => {
        const user = onlineUsers.get(socket.id);
        if (!user || !data.callId) return;
        
        const messages = loadMessages();
        const callIndex = messages.findIndex(m => m.id === data.callId);
        if (callIndex !== -1) {
            messages[callIndex].status = data.status || 'ended';
            messages[callIndex].duration = data.duration || 0;
            saveMessages(messages);
        }
        
        onlineUsers.forEach((userData, socketId) => {
            if (userData.username === (data.to || data.from)) {
                io.to(socketId).emit('call ended', data);
            }
        });
    });

    socket.on('call signaling', (data) => {
        onlineUsers.forEach((userData, socketId) => {
            if (userData.username === data.to) {
                io.to(socketId).emit('call signaling', data);
            }
        });
    });

    socket.on('disconnect', () => {
        const user = onlineUsers.get(socket.id);
        if (user) {
            if (rooms.has(user.room)) {
                rooms.get(user.room).delete(socket.id);
            }
            io.to(user.room).emit('user left', { id: socket.id, name: user.username });
        }
        onlineUsers.delete(socket.id);
        console.log('User disconnected:', socket.id);
    });
});

server.listen(3000, '0.0.0.0', () => {
    console.log('Server running on http://localhost:3000');
    console.log('For mobile access, use your local IP, e.g., http://192.168.1.X:3000');
});