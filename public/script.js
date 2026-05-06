const socket = io();

// Welcome video
const welcomeVideo = document.getElementById('welcome-video');
const welcomeVideoPlayer = document.getElementById('welcome-video-player');
const skipBtn = document.getElementById('skip-video');
const container = document.querySelector('.container');

if (welcomeVideo && welcomeVideoPlayer) {
    welcomeVideo.classList.remove('hidden');
    container.style.display = 'none';
    
    welcomeVideoPlayer.play().catch(() => {});
    
    let videoSkipped = false;
    const skipVideo = () => {
        if (videoSkipped) return;
        videoSkipped = true;
        welcomeVideo.classList.add('hidden');
        container.style.display = 'flex';
    };
    
    welcomeVideoPlayer.addEventListener('ended', skipVideo);
    
    setTimeout(skipVideo, 3000);
    
    if (skipBtn) {
        skipBtn.addEventListener('click', skipVideo);
    }
}

let username = '';
let currentRoom = 'general';
let currentChatType = 'room'; // 'room' or 'private'
let privateToUser = null;
let activePrivateChat = null;
const onlineUsers = new Map();
const privateChats = new Map();
let selectionMode = false;
let selectedMessages = new Set();
let starredMessages = JSON.parse(localStorage.getItem('starredMessages') || '[]');
let unreadCounts = JSON.parse(localStorage.getItem('unreadCounts') || '{}');
let myContacts = JSON.parse(localStorage.getItem('myContacts_' + username) || '[]');

function saveContacts() {
    localStorage.setItem('myContacts_' + username, JSON.stringify(myContacts));
}

function loadContactsList() {
    const list = document.getElementById('contacts-list');
    const chatsList = document.getElementById('recent-chats-list');
    list.innerHTML = '';
    chatsList.innerHTML = '';
    
    if (myContacts.length === 0) {
        list.innerHTML = '<li style="color:#888;font-size:0.85rem;padding:15px;">No contacts yet. Add a username below!</li>';
        return;
    }
    
    myContacts.forEach(contact => {
        const count = getUnreadCount(contact);
        const initial = contact.charAt(0).toUpperCase();
        
        // Contacts list
        const li = document.createElement('li');
        li.className = 'chat-item';
        li.dataset.user = contact;
        li.innerHTML = `
            <div class="chat-avatar">${initial}<span class="online-dot" style="display:${Array.from(onlineUsers.values()).includes(contact) ? 'block' : 'none'}"></span></div>
            <div class="chat-info">
                <div class="chat-info-top"><span class="chat-name">@${contact}</span><span class="unread-badge" style="display:${count > 0 ? 'inline-block' : 'none'}">${count > 99 ? '99+' : count}</span></div>
            </div>
            <button class="remove-contact" data-contact="${contact}"><i data-lucide="x"></i></button>
        `;
        li.onclick = (e) => {
            if (e.target.closest('.remove-contact')) return;
            openPrivateChat(contact);
        };
        list.appendChild(li);
        
        const removeBtn = li.querySelector('.remove-contact');
        if (removeBtn) {
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm('Remove ' + contact + ' from contacts?')) {
                    myContacts = myContacts.filter(c => c !== contact);
                    saveContacts();
                    loadContactsList();
                }
            });
        }
        
        // Recent chats list
        const chatLi = document.createElement('li');
        chatLi.className = 'chat-item';
        chatLi.dataset.user = contact;
        chatLi.innerHTML = `
            <div class="chat-avatar">${initial}</div>
            <div class="chat-info">
                <div class="chat-info-top"><span class="chat-name">@${contact}</span><span class="chat-time"></span></div>
                <div class="chat-preview">Start a conversation</div>
            </div>
            <div class="chat-meta"><span class="unread-badge" style="display:${count > 0 ? 'inline-block' : 'none'}">${count > 99 ? '99+' : count}</span></div>
        `;
        chatLi.onclick = () => openPrivateChat(contact);
        chatsList.appendChild(chatLi);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function addContact(contactUser) {
    if (!myContacts.includes(contactUser) && contactUser !== username) {
        myContacts.push(contactUser);
        saveContacts();
        loadContactsList();
        return true;
    }
    return false;
}

function saveUnreadCounts() {
    localStorage.setItem('unreadCounts', JSON.stringify(unreadCounts));
}

function getUnreadCount(user) {
    return unreadCounts[user] || 0;
}

function setUnreadCount(user, count) {
    unreadCounts[user] = count;
    saveUnreadCounts();
    updatePrivateChatsListUI();
}

function updatePrivateChatsListUI() {
    const privateChatsList = document.getElementById('private-chats-list');
    Array.from(privateChatsList.children).forEach(li => {
        const user = li.dataset.user;
        const count = getUnreadCount(user);
        const badge = li.querySelector('.unread-badge');
        if (count > 0) {
            if (badge) {
                badge.textContent = count > 99 ? '99+' : count;
            } else {
                const span = document.createElement('span');
                span.className = 'unread-badge';
                span.textContent = count > 99 ? '99+' : count;
                li.appendChild(span);
            }
            li.classList.add('unread');
        } else {
            if (badge) badge.remove();
            li.classList.remove('unread');
        }
    });
}

function saveStarredMessages() {
    localStorage.setItem('starredMessages', JSON.stringify(starredMessages));
}

const authScreen = document.getElementById('auth-screen');
const chatScreen = document.getElementById('chat-screen');
const tabBtns = document.querySelectorAll('.tab-btn');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const loginBtn = document.getElementById('login-btn');
const registerBtn = document.getElementById('register-btn');
const logoutBtn = document.getElementById('logout-btn');
const themeBtn = document.getElementById('theme-btn');
const loginUsername = document.getElementById('login-username');
const loginPassword = document.getElementById('login-password');
const registerUsername = document.getElementById('register-username');
const registerPassword = document.getElementById('register-password');
const registerConfirm = document.getElementById('register-confirm');
const loginError = document.getElementById('login-error');
const registerError = document.getElementById('register-error');
const messageInput = document.getElementById('message-input');
const messagesContainer = document.getElementById('messages');
const userList = document.getElementById('user-list');
const roomList = document.getElementById('room-list');
const currentRoomEl = document.getElementById('current-room');
const chatTypeEl = document.getElementById('chat-type');
const typingIndicator = document.getElementById('typing-indicator');
const emojiBtn = document.getElementById('emoji-btn');
const micBtn = document.getElementById('mic-btn');
const fileBtn = document.getElementById('file-btn');
const voiceCallBtn = document.getElementById('voice-call-btn');
const videoCallBtn = document.getElementById('video-call-btn');
const fileInput = document.getElementById('file-input');
const sendBtn = document.getElementById('send-btn');
const statusEl = document.querySelector('.status');
const newRoomName = document.getElementById('new-room-name');
const createRoomBtn = document.getElementById('create-room-btn');
const privateModal = document.getElementById('private-modal');
const pmTo = document.getElementById('pm-to');
const pmText = document.getElementById('pm-text');
const sendPmBtn = document.getElementById('send-pm-btn');
const closeModal = document.querySelector('.close');
const privateChatsList = document.getElementById('private-chats-list');
const callModal = document.getElementById('call-modal');
const incomingCallModal = document.getElementById('incoming-call-modal');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const endCallBtn = document.getElementById('end-call-btn');
const muteBtn = document.getElementById('mute-btn');
const videoToggleBtn = document.getElementById('video-toggle-btn');
const acceptCallBtn = document.getElementById('accept-call-btn');
const declineCallBtn = document.getElementById('decline-call-btn');
const searchInput = document.getElementById('search-input');
const searchContactInput = document.getElementById('search-contact');
const addContactBtn = document.getElementById('add-contact-btn');
const replyPreview = document.getElementById('reply-preview');
const cancelReplyBtn = document.getElementById('cancel-reply');
const forwardModal = document.getElementById('forward-modal');
const forwardTo = document.getElementById('forward-to');
const forwardBtn = document.getElementById('forward-btn');
const profilePicModal = document.getElementById('profile-pic-modal');
const profilePicInput = document.getElementById('profile-pic-input');
const uploadPicBtn = document.getElementById('upload-pic-btn');

let replyTo = null;
let forwardMessage = null;

let typingTimeout;
let typing = false;

let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

let localStream = null;
let peerConnection = null;
let currentCallType = null;
let callPartner = null;
let currentCallId = null;
let callStartTime = null;
let isMuted = false;
let isVideoEnabled = true;

const iceServers = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// Tab switching
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        if (tab === 'login') {
            loginForm.classList.remove('hidden');
            registerForm.classList.add('hidden');
        } else {
            loginForm.classList.add('hidden');
            registerForm.classList.remove('hidden');
        }
    });
});

// Login
loginBtn.addEventListener('click', async () => {
    const user = loginUsername.value.trim();
    const pass = loginPassword.value;
    loginError.textContent = '';
    
    if (!user || !pass) {
        loginError.textContent = 'Username and password required';
        return;
    }
    
    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass })
    });
    const data = await res.json();
    
    if (data.success) {
        username = data.username;
        showChat();
    } else {
        loginError.textContent = data.message;
    }
});

loginPassword.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') loginBtn.click();
});

// Register
registerBtn.addEventListener('click', async () => {
    const user = registerUsername.value.trim();
    const pass = registerPassword.value;
    const confirm = registerConfirm.value;
    registerError.textContent = '';
    
    if (!user || !pass || !confirm) {
        registerError.textContent = 'All fields required';
        return;
    }
    
    if (pass !== confirm) {
        registerError.textContent = 'Passwords do not match';
        return;
    }
    
    const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass })
    });
    const data = await res.json();
    
    if (data.success) {
        alert('Registration successful! Please login.');
        tabBtns[0].click();
    } else {
        registerError.textContent = data.message;
    }
});

registerConfirm.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') registerBtn.click();
});

// Logout
logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    username = '';
    onlineUsers.clear();
    userList.innerHTML = '';
    messagesContainer.innerHTML = '';
    chatScreen.classList.add('hidden');
    authScreen.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
    loginUsername.value = '';
    loginPassword.value = '';
    registerUsername.value = '';
    registerPassword.value = '';
    registerConfirm.value = '';
    document.getElementById('sidebar').classList.remove('open');
    myContacts = [];
});

// Mobile menu toggle
const menuBtn = document.getElementById('menu-btn');
if (menuBtn) {
    menuBtn.addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
    });
    
    // Close sidebar when clicking outside
    document.getElementById('main-chat').addEventListener('click', () => {
        document.getElementById('sidebar').classList.remove('open');
    });
}

// Theme toggle
themeBtn.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    const isDark = document.body.classList.contains('dark');
    themeBtn.innerHTML = isDark ? '<i data-lucide="sun"></i>' : '<i data-lucide="moon"></i>';
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    if (typeof lucide !== 'undefined') lucide.createIcons();
});

if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark');
    themeBtn.innerHTML = '<i data-lucide="sun"></i>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Edit Profile
const editProfileBtn = document.getElementById('edit-profile-btn');
const editProfileModal = document.getElementById('edit-profile-modal');
const closeEdit = document.querySelector('.close-edit');
const editUsername = document.getElementById('edit-username');
const editPassword = document.getElementById('edit-password');
const editCurrentPassword = document.getElementById('edit-current-password');
const saveProfileBtn = document.getElementById('save-profile-btn');
const editError = document.getElementById('edit-error');

editProfileBtn.addEventListener('click', () => {
    showUserProfile(username);
});

closeEdit.addEventListener('click', () => {
    editProfileModal.classList.add('hidden');
    editUsername.value = '';
    editPassword.value = '';
    editCurrentPassword.value = '';
    editError.textContent = '';
});

document.querySelector('.close-pic').addEventListener('click', () => {
    profilePicModal.classList.add('hidden');
});

saveProfileBtn.addEventListener('click', async () => {
    const newUsername = editUsername.value.trim();
    const newPassword = editPassword.value;
    const currentPassword = editCurrentPassword.value;
    
    if (!newUsername || !currentPassword) {
        editError.textContent = 'Username and current password are required';
        return;
    }
    
    try {
        const res = await fetch('/api/update-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                currentUsername: username,
                currentPassword: currentPassword,
                newUsername: newUsername,
                newPassword: newPassword
            })
        });
        const data = await res.json();
        
        if (data.success) {
            username = newUsername;
            editProfileModal.classList.add('hidden');
            alert('Profile updated! Please login again.');
            logoutBtn.click();
        } else {
            editError.textContent = data.message;
        }
    } catch (err) {
        editError.textContent = 'Failed to update profile';
    }
});

const changePicBtn = document.getElementById('change-pic-btn');
changePicBtn.addEventListener('click', () => {
    editProfileModal.classList.add('hidden');
    profilePicModal.classList.remove('hidden');
});

// User profile panel
const userProfileModal = document.getElementById('user-profile-modal');
const myProfileModal = document.getElementById('my-profile-modal');

async function showUserProfile(targetUser) {
    const profileModal = targetUser === username ? myProfileModal : userProfileModal;
    const picId = targetUser === username ? 'my-profile-modal-pic' : 'profile-modal-pic';
    const nameId = targetUser === username ? 'my-profile-modal-username' : 'profile-modal-username';
    const statusId = targetUser === username ? 'my-profile-modal-status' : 'profile-modal-status';
    
    document.getElementById(nameId).textContent = targetUser;
    document.getElementById(statusId).textContent = Array.from(onlineUsers.values()).includes(targetUser) ? 'Online' : 'Offline';
    
    // Load profile picture
    try {
        const res = await fetch('/api/profile-pic/' + targetUser);
        const data = await res.json();
        if (data.profilePic) {
            document.getElementById(picId).src = '/uploads/' + data.profilePic;
            document.getElementById(picId).style.display = 'block';
        } else {
            document.getElementById(picId).src = '';
            document.getElementById(picId).style.display = 'none';
        }
    } catch (err) {
        console.error('Failed to load profile pic:', err);
    }
    
    profileModal.classList.remove('hidden');
}

document.getElementById('close-profile-modal').addEventListener('click', () => {
    userProfileModal.classList.add('hidden');
});

document.getElementById('close-my-profile-modal').addEventListener('click', () => {
    myProfileModal.classList.add('hidden');
});

document.getElementById('pm-from-profile').addEventListener('click', () => {
    userProfileModal.classList.add('hidden');
    openPrivateChat(document.getElementById('profile-modal-username').textContent);
});

document.getElementById('edit-profile-from-modal').addEventListener('click', () => {
    myProfileModal.classList.add('hidden');
    editProfileModal.classList.remove('hidden');
});

function showChat() {
    authScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
    logoutBtn.classList.remove('hidden');
    
    // Load user-specific contacts
    myContacts = JSON.parse(localStorage.getItem('myContacts_' + username) || '[]');
    
    console.log('Joining room:', currentRoom, 'as', username);
    socket.emit('join', { username: username, room: currentRoom });
    
    loadAllUsers();
    setupSidebarTabs();
    loadProfilePic(username);
    updatePrivateChatsListUI();
    loadContactsList();
    
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function setupSidebarTabs() {
    const tabs = document.querySelectorAll('#tabs button');
    const chatsView = document.getElementById('chats-view');
    const contactsView = document.getElementById('contacts-view');
    const roomsView = document.getElementById('rooms-view');
    const starredView = document.getElementById('starred-view');
    const callsView = document.getElementById('calls-view');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('tab-active'));
            tab.classList.add('tab-active');
            
            const view = tab.dataset.view;
            chatsView.classList.add('hidden');
            contactsView.classList.add('hidden');
            roomsView.classList.add('hidden');
            starredView.classList.add('hidden');
            callsView.classList.add('hidden');
            
            if (view === 'chats') {
                chatsView.classList.remove('hidden');
                loadContactsList();
            } else if (view === 'contacts') {
                contactsView.classList.remove('hidden');
                loadContactsList();
            } else if (view === 'starred') {
                showStarredMessages();
            } else if (view === 'calls') {
                showCallHistory();
            }
        });
    });
}

async function showCallHistory() {
    const callList = document.getElementById('call-history-list');
    callList.innerHTML = '';
    
    try {
        const res = await fetch('/api/call-history');
        const calls = await res.json();
        
        if (calls.length === 0) {
            callList.innerHTML = '<li style="color:#888;font-size:0.85rem;padding:10px;">No call history yet.</li>';
            return;
        }
        
        calls.reverse().forEach(call => {
            const li = document.createElement('li');
            li.className = 'call-history-item';
            const isIncoming = call.to === username;
            const otherUser = isIncoming ? call.from : call.to;
            const duration = call.duration ? formatDuration(call.duration) : '';
            const statusIcon = call.status === 'answered' ? '↔️' : (call.status === 'missed' ? (isIncoming ? '📵' : '📞') : '📞');
            const time = new Date(call.timestamp).toLocaleString();
            
            li.innerHTML = `
                <div class="call-icon">${statusIcon}</div>
                <div class="call-info">
                    <div class="call-user">${otherUser}</div>
                    <div class="call-detail">${call.callType === 'video' ? 'Video' : 'Voice'} • ${duration || time}</div>
                </div>
            `;
            li.onclick = () => openPrivateChat(otherUser);
            callList.appendChild(li);
        });
    } catch (err) {
        console.error('Failed to load call history:', err);
    }
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins + 'm ' + secs + 's';
}

async function loadAllUsers() {
    try {
        const res = await fetch('/api/users');
        const users = await res.json();
        const allUsersList = document.getElementById('all-users-list');
        allUsersList.innerHTML = '';
        users.forEach(user => {
            const li = document.createElement('li');
            const safeName = user.username.replace(/[^a-zA-Z0-9]/g, '');
            const isOnline = Array.from(onlineUsers.values()).includes(user.username);
            const picHtml = `<img class="profile-pic pic-${safeName}" id="allpic-${safeName}" src="" onerror="this.style.display='none'" style="display:none;width:24px;height:24px;border-radius:50%;margin-right:5px;cursor:pointer;" data-sender="${user.username}">`;
            li.innerHTML = `<img class="profile-pic pic-${safeName}" id="allpic-${safeName}" src="" onerror="this.style.display='none'" style="display:none;width:24px;height:24px;border-radius:50%;margin-right:5px;cursor:pointer;" data-sender="${user.username}"><span class="user-name" style="cursor:pointer" data-sender="${user.username}">${user.username}</span>`;
            li.style.opacity = isOnline ? '1' : '0.5';
            li.style.display = 'flex';
            li.style.alignItems = 'center';
            li.addEventListener('click', (e) => {
                if (e.target.dataset.sender || e.target.closest('[data-sender]')) {
                    showUserProfile(user.username);
                }
            });
            allUsersList.appendChild(li);
            loadProfilePic(user.username);
        });
    } catch (err) {
        console.error('Failed to load users:', err);
    }
}

function openPrivateChat(user) {
    currentChatType = 'private';
    activePrivateChat = user;
    privateToUser = user;
    
    // Auto-add to contacts
    if (!myContacts.includes(user)) {
        myContacts.push(user);
        saveContacts();
        loadContactsList();
    }
    
    setUnreadCount(user, 0);
    
    if (!privateChats.has(user)) {
        privateChats.set(user, []);
    }
    
    currentRoomEl.textContent = '@' + user;
    chatTypeEl.textContent = 'Online';
    
    const headerAvatar = document.getElementById('header-avatar');
    if (headerAvatar) headerAvatar.textContent = user.charAt(0).toUpperCase();
    
    messagesContainer.innerHTML = '';
    
    async function loadPrivateHistory() {
        try {
            const res = await fetch('/api/private-messages/' + user);
            const messages = await res.json();
            messages.forEach(msg => {
                const isOwn = msg.sender === username;
                addMessage(msg.sender, msg.text, isOwn, msg.time, true, false, msg.deletedForEveryone, msg.deletedForMe);
            });
        } catch (err) {
            console.error('Failed to load private messages:', err);
        }
    }
    
    loadPrivateHistory();
    
    const privateChatsList = document.getElementById('private-chats-list');
    let existingChat = Array.from(privateChatsList.children).find(li => li.dataset.user === user);
    if (!existingChat) {
        const li = document.createElement('li');
        li.className = 'chat-item';
        li.dataset.user = user;
        li.innerHTML = `<div class="chat-avatar">${user.charAt(0).toUpperCase()}</div><div class="chat-info"><div class="chat-info-top"><span class="chat-name">@${user}</span><span class="chat-time"></span></div><div class="chat-preview">Loading...</div></div>`;
        li.onclick = () => openPrivateChat(user);
        privateChatsList.appendChild(li);
        
        async function loadPreview() {
            try {
                const res = await fetch('/api/private-messages/' + user);
                const messages = await res.json();
                if (messages.length > 0) {
                    const lastMsg = messages[messages.length - 1];
                    const preview = lastMsg.text.length > 30 ? lastMsg.text.substring(0, 30) + '...' : lastMsg.text;
                    li.querySelector('.chat-preview').textContent = preview;
                }
            } catch (err) {}
        }
        loadPreview();
    } else {
        existingChat.onclick = () => openPrivateChat(user);
    }
    
    const tabs = document.querySelectorAll('#tabs button');
    tabs[1].click();
}

function showStarredMessages() {
    const starredList = document.getElementById('starred-messages-list');
    starredList.innerHTML = '';
    
    if (starredMessages.length === 0) {
        starredList.innerHTML = '<li style="color:#888;font-size:0.85rem;padding:10px;">No starred messages yet.\nDouble-click messages to star them.</li>';
        return;
    }
    
    starredMessages.forEach((msg, index) => {
        const li = document.createElement('li');
        li.className = 'starred-message-item';
        li.innerHTML = `
            <div class="star-sender">${msg.sender}</div>
            <div class="star-text">${msg.text}</div>
            <div class="star-meta">${msg.time} ${msg.isPrivate ? '• Private' : '• ' + msg.room}</div>
            <button class="unstar-btn" data-index="${index}">Remove</button>
        `;
        li.querySelector('.unstar-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            starredMessages.splice(index, 1);
            saveStarredMessages();
            showStarredMessages();
        });
        starredList.appendChild(li);
    });
}

// Typing indicator
messageInput.addEventListener('input', () => {
    if (!typing) {
        typing = true;
        socket.emit('typing');
    }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        typing = false;
        socket.emit('stop typing');
    }, 1500);
});

// Add contact
addContactBtn.addEventListener('click', () => {
    const target = searchContactInput.value.trim();
    if (!target) return;
    
    if (target === username) {
        alert("You can't add yourself!");
        return;
    }
    
    if (myContacts.includes(target)) {
        alert('Already in your contacts!');
        return;
    }
    
    // Check if user exists on server
    fetch('/api/users')
        .then(res => res.json())
        .then(users => {
            const exists = users.find(u => u.username.toLowerCase() === target.toLowerCase());
            if (exists) {
                myContacts.push(exists.username);
                saveContacts();
                loadContactsList();
                searchContactInput.value = '';
                alert(exists.username + ' added to contacts!');
            } else {
                alert('User not found!');
            }
        });
});

searchContactInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addContactBtn.click();
});

// Send message
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// Selection toolbar
document.getElementById('btn-cancel-select').addEventListener('click', exitSelectionMode);

document.getElementById('btn-delete-select').addEventListener('click', () => {
    selectedMessages.forEach(msgId => {
        const msgEl = document.querySelector(`.message[data-msg-id="${msgId}"]`);
        if (msgEl) {
            const sender = msgEl.dataset.sender;
            const time = msgEl.dataset.time;
            socket.emit('delete message', { msgId: msgId, sender: sender, time: time, type: 'everyone', room: currentChatType === 'private' ? activePrivateChat : currentRoom, chatType: currentChatType });
            msgEl.remove();
        }
    });
    exitSelectionMode();
});

document.getElementById('btn-copy').addEventListener('click', () => {
    let texts = [];
    selectedMessages.forEach(msgId => {
        const msgEl = document.querySelector(`.message[data-msg-id="${msgId}"]`);
        if (msgEl) {
            const text = msgEl.querySelector('.text').textContent;
            texts.push(text);
        }
    });
    navigator.clipboard.writeText(texts.join('\n'));
    exitSelectionMode();
});

document.getElementById('btn-star').addEventListener('click', () => {
    selectedMessages.forEach(msgId => {
        const msgEl = document.querySelector(`.message[data-msg-id="${msgId}"]`);
        if (msgEl) {
            msgEl.classList.add('starred');
            const msgData = {
                msgId: msgId,
                sender: msgEl.dataset.sender,
                text: msgEl.querySelector('.text').textContent,
                time: msgEl.dataset.time,
                isPrivate: currentChatType === 'private',
                room: currentChatType === 'private' ? activePrivateChat : currentRoom
            };
            if (!starredMessages.find(m => m.msgId === msgId)) {
                starredMessages.push(msgData);
            }
        }
    });
    saveStarredMessages();
    exitSelectionMode();
});

document.getElementById('btn-forward-select').addEventListener('click', () => {
    let texts = [];
    selectedMessages.forEach(msgId => {
        const msgEl = document.querySelector(`.message[data-msg-id="${msgId}"]`);
        if (msgEl) {
            const sender = msgEl.dataset.sender;
            const text = msgEl.querySelector('.text').textContent;
            texts.push({ sender, text });
        }
    });
    if (texts.length > 0) {
        forwardMessage = { sender: texts[0].sender, text: texts.map(t => t.text).join('\n'), time: getTime() };
        forwardTo.value = '';
        forwardModal.classList.remove('hidden');
    }
    exitSelectionMode();
});

document.getElementById('btn-edit-select').addEventListener('click', () => {
    if (selectedMessages.size !== 1) return;
    const msgId = Array.from(selectedMessages)[0];
    const msgEl = document.querySelector(`.message[data-msg-id="${msgId}"]`);
    if (msgEl && msgEl.dataset.sender === username) {
        const text = msgEl.querySelector('.text').textContent;
        messageInput.value = text;
        messageInput.focus();
        socket.emit('delete message', { msgId: msgId, sender: username, time: msgEl.dataset.time, type: 'everyone', room: currentChatType === 'private' ? activePrivateChat : currentRoom, chatType: currentChatType });
        msgEl.remove();
    }
    exitSelectionMode();
});

// Enable selection mode by long press or double click
let clickCount = 0;
let clickTimer = null;

messagesContainer.addEventListener('click', (e) => {
    if (!selectionMode) {
        clickCount++;
        if (clickCount === 1) {
            clickTimer = setTimeout(() => { clickCount = 0; }, 300);
        } else if (clickCount === 2) {
            clearTimeout(clickTimer);
            clickCount = 0;
            enterSelectionMode();
        }
    }
});

function sendMessage() {
    const text = messageInput.value.trim();
    if (text) {
        const messageData = { sender: username, text: text, time: getTime(), status: 'sent' };
        
        if (replyTo) {
            messageData.replyTo = replyTo;
        }
        
        if (currentChatType === 'private' && activePrivateChat) {
            socket.emit('private message', { to: activePrivateChat, message: text, replyTo: replyTo });
            
            const msgData = { sender: username, text: text, time: getTime(), replyTo: replyTo };
            if (privateChats.has(activePrivateChat)) {
                privateChats.get(activePrivateChat).push(msgData);
            } else {
                privateChats.set(activePrivateChat, [msgData]);
            }
            
            addMessage(username, text, true, getTime(), true, false, false, false, false, null, replyTo, null, 'sent');
        } else {
            socket.emit('chat message', { sender: username, text: text, replyTo: replyTo });
            addMessage(username, text, true, getTime(), false, false, false, false, null, replyTo, null, 'sent');
        }
        
        messageInput.value = '';
        typing = false;
        socket.emit('stop typing');
        
        replyTo = null;
        replyPreview.classList.add('hidden');
    }
}

// File upload
fileBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();
        
        if (data.success) {
            const text = `<a href="/uploads/${data.filename}" target="_blank">📎 ${file.name}</a>`;
            socket.emit('chat message', { sender: username, text: text, file: data.filename });
        }
    } catch (err) {
        console.error('Upload failed:', err);
    }
    fileInput.value = '';
});

// Emoji picker
const emojiCategories = {
    'Smileys': ['😀','😂','😊','😍','🤔','😢','😡','🤯','🥰','😎','🤩','😇','😈','👻','🤖','💩'],
    'Gestures': ['👍','👎','👋','✌️','🤞','🤙','🤚','👊','✋','👌','🤟','🙏','👏','🙌','🤲'],
    'Hearts': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','❣️','💕','💞','💗','💖','💘','💝'],
    'Objects': ['🔥','💯','🎉','🎊','🏆','🎁','⭐','🌟','💎','🔔','🔕','📢','💥','💫','💦','🎵','🎶']
};

let emojiPickerOpen = false;

emojiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    
    let picker = document.querySelector('.emoji-picker');
    if (picker) {
        picker.remove();
        emojiPickerOpen = false;
        return;
    }
    
    emojiPickerOpen = true;
    picker = document.createElement('div');
    picker.className = 'emoji-picker';
    picker.style.cssText = 'position:absolute;bottom:60px;left:5px;background:white;padding:10px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.15);z-index:100;width:280px;max-height:250px;overflow-y:auto;';
    
    Object.keys(emojiCategories).forEach(category => {
        const catHeader = document.createElement('div');
        catHeader.textContent = category;
        catHeader.style.cssText = 'font-size:0.75rem;font-weight:600;color:#718096;margin:10px 0 5px 0;text-transform:uppercase;';
        picker.appendChild(catHeader);
        
        const emojiGrid = document.createElement('div');
        emojiGrid.style.cssText = 'display:grid;grid-template-columns:repeat(8,1fr);gap:2px;';
        
        emojiCategories[category].forEach(emoji => {
            const span = document.createElement('span');
            span.textContent = emoji;
            span.style.cssText = 'cursor:pointer;padding:4px;font-size:1.3rem;text-align:center;border-radius:4px;transition:background 0.2s;';
            span.onmouseover = () => span.style.background = '#e2e8f0';
            span.onmouseout = () => span.style.background = 'transparent';
            span.onclick = () => {
                messageInput.value += emoji;
                picker.remove();
                emojiPickerOpen = false;
            };
            emojiGrid.appendChild(span);
        });
        picker.appendChild(emojiGrid);
    });
    
    document.getElementById('input-area').appendChild(picker);
});

document.addEventListener('click', (e) => {
    if (emojiPickerOpen && !e.target.closest('.emoji-picker') && e.target !== emojiBtn) {
        const picker = document.querySelector('.emoji-picker');
        if (picker) picker.remove();
        emojiPickerOpen = false;
    }
});

// Room selection
roomList.addEventListener('click', (e) => {
    if (e.target.tagName === 'LI') {
        const room = e.target.getAttribute('data-room');
        if (room && room !== currentRoom) {
            console.log('Switching to room:', room);
            currentRoom = room;
            currentChatType = 'room';
            activePrivateChat = null;
            currentRoomEl.textContent = '#' + room;
            chatTypeEl.textContent = 'Room';
            
            const headerAvatar = document.getElementById('header-avatar');
            if (headerAvatar) headerAvatar.textContent = room.charAt(0).toUpperCase();
            
            messagesContainer.innerHTML = '';
            
            roomList.querySelectorAll('li').forEach(l => l.classList.remove('active'));
            e.target.classList.add('active');
            
            const tabs = document.querySelectorAll('#tabs button');
            tabs[0].click();
            
            socket.emit('join room', { username: username, room: room });
        }
    }
});

// Create new room
createRoomBtn.addEventListener('click', () => {
    const room = newRoomName.value.trim().toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    if (room && room.length > 0) {
        const li = document.createElement('li');
        li.setAttribute('data-room', room);
        li.textContent = '#' + room;
        roomList.appendChild(li);
        
        currentRoom = room;
        currentChatType = 'room';
        activePrivateChat = null;
        currentRoomEl.textContent = '#' + room;
        chatTypeEl.textContent = 'Room';
        
        const headerAvatar = document.getElementById('header-avatar');
        if (headerAvatar) headerAvatar.textContent = room.charAt(0).toUpperCase();
        
        messagesContainer.innerHTML = '';
        
        const tabs = document.querySelectorAll('#tabs button');
        tabs[0].click();
        
        socket.emit('join room', { username: username, room: room });
        newRoomName.value = '';
    }
});

// Private message - click on user
userList.addEventListener('click', (e) => {
    if (e.target.tagName === 'LI') {
        const user = e.target.textContent;
        if (user && user !== username) {
            openPrivateChat(user);
        }
    }
});

// Close modal
closeModal.addEventListener('click', () => {
    privateModal.classList.add('hidden');
    pmText.value = '';
    privateToUser = null;
});

// Send private message
sendPmBtn.addEventListener('click', () => {
    const text = pmText.value.trim();
    if (text && privateToUser) {
        socket.emit('private message', { to: privateToUser, message: text });
        privateModal.classList.add('hidden');
        pmText.value = '';
        privateToUser = null;
    }
});

function getTime() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Check if date is different from today
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (now.toDateString() === today.toDateString()) {
        return 'Today ' + timeStr;
    } else if (now.toDateString() === yesterday.toDateString()) {
        return 'Yesterday ' + timeStr;
    } else {
        return now.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + timeStr;
    }
}

// Socket events
socket.on('connect', () => {
    statusEl.textContent = 'Connected';
    statusEl.style.color = '#68d391';
    console.log('Socket connected');
});

socket.on('disconnect', () => {
    statusEl.textContent = 'Disconnected';
    statusEl.style.color = '#fc8181';
    console.log('Socket disconnected');
});

socket.on('user joined', (data) => {
    console.log('User joined:', data);
    onlineUsers.set(data.id, data.name);
    updateUserList();
    updateAllUsersList();
    addSystemMessage(data.name + ' joined the chat');
});

socket.on('user left', (data) => {
    console.log('User left:', data);
    const leftName = onlineUsers.get(data.id);
    onlineUsers.delete(data.id);
    updateUserList();
    updateAllUsersList();
    if (leftName) addSystemMessage(leftName + ' left the chat');
});

socket.on('chat message', (data) => {
    console.log('Chat message:', data);
    const isOwn = data.sender === username;
    if (!isOwn) {
        addMessage(data.sender, data.text, isOwn, data.time);
    }
});

socket.on('private message', (data) => {
    console.log('Private message:', data);
    const isOwn = data.sender === username;
    const otherUser = isOwn ? data.to : data.sender;
    
    // Auto-add sender to contacts
    if (!isOwn && !myContacts.includes(otherUser)) {
        myContacts.push(otherUser);
        saveContacts();
        loadContactsList();
    }
    
    if (!privateChats.has(otherUser)) {
        privateChats.set(otherUser, []);
    }
    privateChats.get(otherUser).push({ sender: data.sender, text: data.text, time: data.time });
    
    const privateChatsList = document.getElementById('private-chats-list');
    let existingChat = Array.from(privateChatsList.children).find(li => li.dataset.user === otherUser);
    if (!existingChat) {
        const li = document.createElement('li');
        li.className = 'chat-item';
        li.dataset.user = otherUser;
        li.innerHTML = `<div class="chat-avatar">${otherUser.charAt(0).toUpperCase()}</div><div class="chat-info"><div class="chat-info-top"><span class="chat-name">@${otherUser}</span><span class="chat-time"></span></div><div class="chat-preview">${data.text.substring(0, 30)}${data.text.length > 30 ? '...' : ''}</div></div>`;
        li.onclick = () => openPrivateChat(otherUser);
        privateChatsList.appendChild(li);
        updatePrivateChatsListUI();
    } else {
        existingChat.querySelector('.chat-preview').textContent = data.text.substring(0, 30) + (data.text.length > 30 ? '...' : '');
    }
    
    if (currentChatType === 'private' && activePrivateChat === otherUser && !isOwn) {
        addMessage(data.sender, data.text, isOwn, data.time, true);
    } else if (!isOwn) {
        const count = getUnreadCount(otherUser) + 1;
        setUnreadCount(otherUser, count);
    }
});

socket.on('typing', (data) => {
    console.log('Typing:', data);
    typingIndicator.textContent = data.username + ' is typing...';
    typingIndicator.classList.remove('hidden');
    setTimeout(() => {
        typingIndicator.classList.add('hidden');
    }, 3000);
});

socket.on('stop typing', () => {
    typingIndicator.classList.add('hidden');
});

socket.on('message seen', (data) => {
    if (data.by === username) return;
    
    const messages = messagesContainer.querySelectorAll('.message');
    messages.forEach(msg => {
        if (msg.dataset.sender === data.sender) {
            msg.classList.add('seen');
            msg.dataset.status = 'seen';
            const ticks = msg.querySelector('.ticks');
            if (ticks) {
                ticks.className = 'ticks seen';
                ticks.textContent = '✓✓';
            }
        }
    });
});

socket.on('message delivered', (data) => {
    if (data.to === username) return;
    
    const messages = messagesContainer.querySelectorAll('.message');
    messages.forEach(msg => {
        if (msg.dataset.sender === data.sender && msg.dataset.status === 'sent') {
            msg.dataset.status = 'delivered';
            const ticks = msg.querySelector('.ticks');
            if (ticks) {
                ticks.className = 'ticks delivered';
                ticks.textContent = '✓✓';
            }
        }
    });
});

socket.on('delete message', (data) => {
    console.log('Delete message received:', data);
    
    const messages = messagesContainer.querySelectorAll('.message');
    messages.forEach(msg => {
        const msgId = msg.dataset.msgId;
        const msgSender = msg.dataset.sender;
        
        if (data.msgId && msgId === data.msgId) {
            console.log('Found message by ID, deleting...');
            if (data.type === 'everyone') {
                msg.remove();
            } else if (data.type === 'me') {
                msg.classList.add('deleted');
                const textEl = msg.querySelector('.text');
                if (textEl) textEl.innerHTML = '<em>Message deleted</em>';
                const deleteBtn = msg.querySelector('.delete-btn');
                if (deleteBtn) deleteBtn.remove();
            }
        } else if (msgSender === data.sender && data.time) {
            let timeMatch = false;
            if (msg.dataset.time && data.time) {
                timeMatch = msg.dataset.time === data.time || msg.dataset.time.includes(data.time.split(' ').pop());
            }
            if (timeMatch) {
                console.log('Found message by sender+time, deleting...');
                if (data.type === 'everyone') {
                    msg.remove();
                } else if (data.type === 'me') {
                    msg.classList.add('deleted');
                    const textEl = msg.querySelector('.text');
                    if (textEl) textEl.innerHTML = '<em>Message deleted</em>';
                    const deleteBtn = msg.querySelector('.delete-btn');
                    if (deleteBtn) deleteBtn.remove();
                }
            }
        }
    });
});

socket.on('room joined', (data) => {
    console.log('Room joined:', data);
    if (data.messages) {
        data.messages.forEach(msg => {
            const isOwn = msg.sender === username;
            addMessage(msg.sender, msg.text, isOwn, msg.time, false, msg.seen, msg.deletedForEveryone, msg.deletedForMe);
        });
    }
});

socket.on('update users', (data) => {
    console.log('Update users:', data);
    onlineUsers.clear();
    data.forEach(([id, user]) => {
        onlineUsers.set(id, user);
    });
    updateUserList();
});

function updateUserList() {
    userList.innerHTML = '';
    onlineUsers.forEach((name, id) => {
        const li = document.createElement('li');
        const safeName = name.replace(/[^a-zA-Z0-9]/g, '');
        const picHtml = `<img class="profile-pic pic-${safeName}" id="pic-${safeName}" src="" onerror="this.style.display='none'" style="display:none;cursor:pointer;" data-sender="${name}">`;
        li.innerHTML = `${picHtml}<span class="status-dot online"></span> <span class="user-name" style="cursor:pointer" data-sender="${name}">${name}</span>`;
        if (name === username) li.classList.add('active');
        li.addEventListener('click', (e) => {
            if (e.target.dataset.sender || e.target.closest('[data-sender]')) {
                showUserProfile(name);
            }
        });
        userList.appendChild(li);
        loadProfilePic(name);
    });
}

async function loadProfilePic(name) {
    try {
        const res = await fetch('/api/profile-pic/' + name);
        const data = await res.json();
        if (data.profilePic) {
            const pics = document.querySelectorAll('.pic-' + name.replace(/[^a-zA-Z0-9]/g, ''));
            pics.forEach(pic => {
                pic.src = '/uploads/' + data.profilePic;
                pic.style.display = 'inline-block';
            });
        }
    } catch (err) {
        console.error('Failed to load profile pic:', err);
    }
}

async function loadProfilePicForMessage(sender) {
    try {
        const res = await fetch('/api/profile-pic/' + sender);
        const data = await res.json();
        if (data.profilePic) {
            const pics = document.querySelectorAll('.pic-' + sender.replace(/[^a-zA-Z0-9]/g, ''));
            pics.forEach(pic => {
                pic.src = '/uploads/' + data.profilePic;
                pic.style.display = 'inline-block';
            });
        }
    } catch (err) {
        console.error('Failed to load profile pic for message:', err);
    }
}

// Update all users list with online status
function updateAllUsersList() {
    const allUsersList = document.getElementById('all-users-list');
    if (!allUsersList) return;
    
    const onlineUsernames = Array.from(onlineUsers.values());
    Array.from(allUsersList.children).forEach(li => {
        const name = li.textContent.trim();
        const isOnline = onlineUsernames.includes(name);
        li.style.opacity = isOnline ? '1' : '0.5';
    });
}

function addMessage(sender, text, isOwn, time, isPrivate = false, seen = false, deletedForEveryone = false, deletedForMe = false, msgId = null, replyToData = null, forwardedFrom = null, msgStatus = null) {
    if (deletedForEveryone && !isOwn) {
        return; // Don't show deleted messages to others
    }
    
    const messageEl = document.createElement('div');
    messageEl.className = 'message ' + (isOwn ? 'own' : 'other') + (isPrivate ? ' private' : '') + (seen ? ' seen' : '') + (deletedForMe ? ' deleted' : '') + (replyToData ? ' reply' : '') + (forwardedFrom ? ' forwarded' : '');
    messageEl.dataset.msgId = msgId || Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    messageEl.dataset.sender = sender;
    messageEl.dataset.time = time;
    messageEl.dataset.text = text;
    messageEl.dataset.status = msgStatus || 'sent';
    
    let messageContent = text;
    let ticks = '';
    if (isOwn) {
        if (seen) {
            ticks = '<span class="ticks seen">✓✓</span>';
        } else if (msgStatus === 'delivered') {
            ticks = '<span class="ticks delivered">✓✓</span>';
        } else {
            ticks = '<span class="ticks sent">✓</span>';
        }
    }
    let timeDisplay = time + ticks;
    
    if (deletedForEveryone) {
        messageContent = '<em>This message was deleted</em>';
    } else if (deletedForMe) {
        messageContent = '<em>Message deleted</em>';
    }
    
    let replyHtml = '';
    if (replyToData) {
        replyHtml = `<div class="reply-indicator">Replying to ${replyToData.sender}: ${replyToData.text.substring(0, 30)}${replyToData.text.length > 30 ? '...' : ''}</div>`;
    }
    
    let forwardHtml = '';
    if (forwardedFrom) {
        forwardHtml = `<div class="forwarded-indicator">Forwarded from ${forwardedFrom}</div>`;
    }
    
    const senderPicHtml = !isOwn ? `<img class="msg-sender-pic pic-${sender.replace(/[^a-zA-Z0-9]/g, '')}" style="width:32px;height:32px;border-radius:50%;margin-right:8px;vertical-align:middle;display:none;cursor:pointer;" onerror="this.style.display='none'" data-sender="${sender}">` : '';
    
    messageEl.innerHTML = `
        <div class="msg-header">
            ${senderPicHtml}
            <span class="select-checkbox">◻</span>
            ${(!isOwn && !isPrivate) ? '<div class="sender" style="cursor:pointer" data-sender="' + sender + '">' + sender + '</div>' : ''}
            ${isPrivate ? '<div class="sender" style="cursor:pointer" data-sender="' + sender + '">💬 ' + sender + '</div>' : ''}
        </div>
        ${replyHtml}
        ${forwardHtml}
        <div class="text">${messageContent}</div>
        <div class="time">${timeDisplay}</div>
        ${(!deletedForEveryone && !deletedForMe) ? '<div class="action-btns"><span class="reply-btn" title="Reply">↩️</span><span class="forward-btn" title="Forward">↪️</span><span class="delete-btn" title="Delete">🗑️</span></div>' : ''}
    `;

    messageEl.addEventListener('click', (e) => {
        if (selectionMode) {
            toggleMessageSelection(messageEl);
            return;
        }
        if (e.target.dataset.sender || (e.target.closest('.sender') && e.target.closest('.sender').dataset.sender)) {
            const user = e.target.dataset.sender || e.target.closest('.sender').dataset.sender;
            if (user) showUserProfile(user);
        }
    });
    
    if (!isOwn) {
        loadProfilePicForMessage(sender);
    }
    
    if (!deletedForEveryone && !deletedForMe) {
        const replyBtn = messageEl.querySelector('.reply-btn');
        const forwardBtn = messageEl.querySelector('.forward-btn');
        const deleteBtn = messageEl.querySelector('.delete-btn');
        
        if (replyBtn) {
            replyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                replyTo = { sender: sender, text: text };
                replyPreview.querySelector('b').textContent = sender;
                replyPreview.classList.remove('hidden');
                messageInput.focus();
            });
        }
        
        if (forwardBtn) {
            forwardBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                forwardMessage = { sender: sender, text: text, time: time };
                forwardTo.value = '';
                forwardModal.classList.remove('hidden');
            });
        }
        
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showDeleteOptions(messageEl, sender, time);
            });
        }
    }
    
    messagesContainer.appendChild(messageEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    if (!isOwn && !deletedForEveryone) {
        socket.emit('message seen', { sender: sender, room: currentChatType === 'private' ? activePrivateChat : currentRoom, chatType: currentChatType });
    }
}

function toggleMessageSelection(messageEl) {
    const msgId = messageEl.dataset.msgId;
    if (selectedMessages.has(msgId)) {
        selectedMessages.delete(msgId);
        messageEl.classList.remove('selected');
        messageEl.querySelector('.select-checkbox').textContent = '◻';
    } else {
        selectedMessages.add(msgId);
        messageEl.classList.add('selected');
        messageEl.querySelector('.select-checkbox').textContent = '☑';
    }
    updateSelectionToolbar();
}

function updateSelectionToolbar() {
    const toolbar = document.getElementById('selection-toolbar');
    const countEl = document.getElementById('selection-count');
    const count = selectedMessages.size;
    countEl.textContent = count + ' selected';
    
    document.getElementById('btn-edit-select').style.display = count === 1 ? 'flex' : 'none';
}

function enterSelectionMode() {
    selectionMode = true;
    document.body.classList.add('selection-mode');
    document.getElementById('selection-toolbar').classList.remove('hidden');
    document.getElementById('typing-indicator').classList.add('hidden');
}

function exitSelectionMode() {
    selectionMode = false;
    selectedMessages.clear();
    document.body.classList.remove('selection-mode');
    document.getElementById('selection-toolbar').classList.add('hidden');
    document.querySelectorAll('.message.selected').forEach(el => {
        el.classList.remove('selected');
        el.querySelector('.select-checkbox').textContent = '◻';
    });
}

messagesContainer.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = messagesContainer;
    if (scrollTop + clientHeight >= scrollHeight - 50) {
        socket.emit('message seen', { sender: username, room: currentChatType === 'private' ? activePrivateChat : currentRoom, chatType: currentChatType });
    }
});

function addSystemMessage(text) {
    const messageEl = document.createElement('div');
    messageEl.className = 'message system';
    messageEl.style.textAlign = 'center';
    messageEl.style.color = '#718096';
    messageEl.style.fontSize = '0.8rem';
    messageEl.style.margin = '10px 0';
    messageEl.textContent = text;
    messagesContainer.appendChild(messageEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function showDeleteOptions(messageEl, sender, time) {
    const isOwn = sender === username;
    const msgId = messageEl.dataset.msgId;
    let deleteOptions = document.querySelector('.delete-options');
    if (deleteOptions) deleteOptions.remove();
    
    deleteOptions = document.createElement('div');
    deleteOptions.className = 'delete-options';
    deleteOptions.style.cssText = 'position:absolute;background:white;box-shadow:0 2px10px rgba(0,0,0,0.2);border-radius:8px;padding:5px;z-index:100;';
    
    if (isOwn) {
        const deleteAllBtn = document.createElement('button');
        deleteAllBtn.textContent = 'Delete for everyone';
        deleteAllBtn.style.cssText = 'display:block;padding:8px 16px;border:none;background:transparent;cursor:pointer;width:100%;text-align:left;font-size:0.85rem;border-radius:4px;color:#e53e3e;';
        deleteAllBtn.onclick = () => {
            socket.emit('delete message', { msgId: msgId, sender: sender, time: time, type: 'everyone', room: currentChatType === 'private' ? activePrivateChat : currentRoom, chatType: currentChatType });
            messageEl.remove();
            deleteOptions.remove();
        };
        deleteOptions.appendChild(deleteAllBtn);
    }
    
    const deleteMeBtn = document.createElement('button');
    deleteMeBtn.textContent = 'Delete for me';
    deleteMeBtn.style.cssText = 'display:block;padding:8px 16px;border:none;background:transparent;cursor:pointer;width:100%;text-align:left;font-size:0.85rem;border-radius:4px;';
    deleteMeBtn.onclick = () => {
        socket.emit('delete message', { msgId: msgId, sender: sender, time: time, type: 'me', room: currentChatType === 'private' ? activePrivateChat : currentRoom, chatType: currentChatType });
        messageEl.classList.add('deleted');
        const textEl = messageEl.querySelector('.text');
        if (textEl) textEl.innerHTML = '<em>Message deleted</em>';
        const deleteBtn = messageEl.querySelector('.delete-btn');
        if (deleteBtn) deleteBtn.remove();
        deleteOptions.remove();
    };
    deleteOptions.appendChild(deleteMeBtn);
    
    messageEl.appendChild(deleteOptions);
    
    document.addEventListener('click', function closeDeleteOptions(e) {
        if (!deleteOptions.contains(e.target)) {
            deleteOptions.remove();
            document.removeEventListener('click', closeDeleteOptions);
        }
    });
}

// Voice Message Recording
micBtn.addEventListener('click', async () => {
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            
            mediaRecorder.ondataavailable = (e) => {
                audioChunks.push(e.data);
            };
            
            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const formData = new FormData();
                formData.append('file', audioBlob, 'voice-message.webm');
                
                try {
                    const res = await fetch('/api/upload', { method: 'POST', body: formData });
                    const data = await res.json();
                    if (data.success) {
                        const audioUrl = '/uploads/' + data.filename;
                        if (currentChatType === 'private' && activePrivateChat) {
                            socket.emit('private message', { to: activePrivateChat, message: `<audio controls src="${audioUrl}"></audio>`, isVoiceMessage: true });
                        } else {
                            socket.emit('chat message', { sender: username, text: `<audio controls src="${audioUrl}"></audio>`, isVoiceMessage: true });
                        }
                    }
                } catch (err) {
                    console.error('Upload failed:', err);
                }
                
                stream.getTracks().forEach(track => track.stop());
            };
            
            mediaRecorder.start();
            isRecording = true;
            micBtn.classList.add('recording');
            micBtn.innerHTML = '<i data-lucide="square"></i>';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        } catch (err) {
            console.error('Microphone access denied:', err);
            alert('Please allow microphone access to record voice messages');
        }
    } else {
        mediaRecorder.stop();
        isRecording = false;
        micBtn.classList.remove('recording');
        micBtn.innerHTML = '<i data-lucide="mic"></i>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
});

// Voice Call
voiceCallBtn.addEventListener('click', () => {
    if (currentChatType === 'room') {
        alert('Voice calls are only available in private chats');
        return;
    }
    if (!activePrivateChat) {
        alert('Select a private chat to start a voice call');
        return;
    }
    startCall('voice');
});

// Video Call
videoCallBtn.addEventListener('click', () => {
    if (currentChatType === 'room') {
        alert('Video calls are only available in private chats');
        return;
    }
    if (!activePrivateChat) {
        alert('Select a private chat to start a video call');
        return;
    }
    startCall('video');
});

async function startCall(type) {
    try {
        const constraints = {
            audio: true,
            video: type === 'video'
        };
        
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        localVideo.srcObject = localStream;
        
        peerConnection = new RTCPeerConnection(iceServers);
        
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        peerConnection.ontrack = (e) => {
            remoteVideo.srcObject = e.streams[0];
        };
        
        peerConnection.onicecandidate = (e) => {
            if (e.candidate) {
                socket.emit('call signaling', {
                    type: 'ice-candidate',
                    candidate: e.candidate,
                    to: activePrivateChat,
                    callType: type
                });
            }
        };
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        currentCallId = Date.now().toString();
        currentCallType = type;
        callPartner = activePrivateChat;
        callStartTime = Date.now();
        
        socket.emit('call request', {
            to: activePrivateChat,
            callType: type,
            offer: offer,
            callId: currentCallId
        });
        
        callModal.classList.remove('hidden');
        document.getElementById('call-type').textContent = type === 'video' ? 'Video Call' : 'Voice Call';
        document.getElementById('call-status').textContent = 'Calling ' + activePrivateChat + '...';
        
    } catch (err) {
        console.error('Call failed:', err);
        alert('Failed to start call. Please check camera/microphone permissions.');
    }
}

// Call Controls
endCallBtn.addEventListener('click', () => {
    endCall('answered');
});

muteBtn.addEventListener('click', () => {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            isMuted = !audioTrack.enabled;
            muteBtn.textContent = isMuted ? 'Unmute' : 'Mute';
            muteBtn.classList.toggle('off', isMuted);
        }
    }
});

videoToggleBtn.addEventListener('click', () => {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            isVideoEnabled = videoTrack.enabled;
            videoToggleBtn.textContent = isVideoEnabled ? 'Video' : 'Video';
        }
    }
});

function endCall(status = 'missed') {
    const duration = callStartTime ? Math.round((Date.now() - callStartTime) / 1000) : 0;
    
    socket.emit('call ended', {
        callId: currentCallId,
        from: callPartner,
        to: username,
        duration: duration,
        status: status
    });
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    callModal.classList.add('hidden');
    incomingCallModal.classList.add('hidden');
    currentCallType = null;
    callPartner = null;
    currentCallId = null;
    callStartTime = null;
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
}

// Socket events for calls
socket.on('call request', async (data) => {
    callPartner = data.from;
    currentCallType = data.callType;
    currentCallId = data.callId;
    callStartTime = null;
    
    document.getElementById('incoming-caller').textContent = data.from;
    document.getElementById('incoming-call-type').textContent = data.callType === 'video' ? 'Video' : 'Voice';
    incomingCallModal.classList.remove('hidden');
    
    const rtcSessionDescription = new RTCSessionDescription(data.offer);
    peerConnection = new RTCPeerConnection(iceServers);
    
    peerConnection.ontrack = (e) => {
        remoteVideo.srcObject = e.streams[0];
    };
    
    await peerConnection.setRemoteDescription(rtcSessionDescription);
    
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    socket.emit('call signaling', {
        type: 'answer',
        answer: answer,
        to: data.from
    });
});

socket.on('call signaling', async (data) => {
    if (data.type === 'answer' && peerConnection) {
        const rtcSessionDescription = new RTCSessionDescription(data.answer);
        await peerConnection.setRemoteDescription(rtcSessionDescription);
        
        callStartTime = Date.now();
        callModal.classList.remove('hidden');
        document.getElementById('call-status').textContent = 'Connected';
    }
    
    if (data.type === 'ice-candidate' && peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
});

socket.on('call ended', (data) => {
    const duration = data.duration ? formatDuration(data.duration) : '';
    const status = data.status === 'answered' ? 'Call ended (' + duration + ')' : 'Call missed';
    document.getElementById('call-status').textContent = status;
    setTimeout(() => endCall(data.status), 2000);
});

acceptCallBtn.addEventListener('click', async () => {
    try {
        const constraints = {
            audio: true,
            video: currentCallType === 'video'
        };
        
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        localVideo.srcObject = localStream;
        
        if (!peerConnection) {
            peerConnection = new RTCPeerConnection(iceServers);
        }
        
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        peerConnection.ontrack = (e) => {
            remoteVideo.srcObject = e.streams[0];
        };
        
        incomingCallModal.classList.add('hidden');
        callModal.classList.remove('hidden');
        callStartTime = Date.now();
        document.getElementById('call-type').textContent = currentCallType === 'video' ? 'Video Call' : 'Voice Call';
        document.getElementById('call-status').textContent = 'Connected';
        
    } catch (err) {
        console.error('Failed to accept call:', err);
    }
});

declineCallBtn.addEventListener('click', () => {
    incomingCallModal.classList.add('hidden');
    endCall();
});

// Search messages
searchInput.addEventListener('input', () => {
    const searchTerm = searchInput.value.toLowerCase();
    const messages = messagesContainer.querySelectorAll('.message');
    
    messages.forEach(msg => {
        const text = msg.dataset.text ? msg.dataset.text.toLowerCase() : '';
        if (searchTerm && text.includes(searchTerm)) {
            msg.classList.add('highlight');
            setTimeout(() => msg.classList.remove('highlight'), 2000);
        }
    });
});

// Forward modal
forwardBtn.addEventListener('click', async () => {
    const to = forwardTo.value.trim();
    if (!to || !forwardMessage) return;
    
    socket.emit('private message', { to: to, message: `[Forwarded from ${forwardMessage.sender}]: ${forwardMessage.text}`, forwardedFrom: forwardMessage.sender });
    forwardModal.classList.add('hidden');
    forwardMessage = null;
});

document.querySelector('.close-forward').addEventListener('click', () => {
    forwardModal.classList.add('hidden');
    forwardMessage = null;
});

// Reply preview
cancelReplyBtn.addEventListener('click', () => {
    replyTo = null;
    replyPreview.classList.add('hidden');
});

// Profile picture upload
uploadPicBtn.addEventListener('click', async () => {
    const file = profilePicInput.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const res = await fetch('/api/upload-profilepic', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
            profilePicModal.classList.add('hidden');
            alert('Profile picture updated!');
        }
    } catch (err) {
        console.error('Upload failed:', err);
    }
});