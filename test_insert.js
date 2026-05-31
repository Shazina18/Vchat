const initSqlJs = require('sql.js');
const fs = require('fs');
(async () => {
    const SQL = await initSqlJs();
    const data = fs.readFileSync('vchat.db');
    const db = new SQL.Database(data);

    // Try inserting a test message
    try {
        db.run("INSERT INTO messages (id, sender, text, room, isPrivate, type, timestamp, time) VALUES (?, ?, ?, ?, 0, 'message', ?, ?)",
            ['test123', 'testuser', 'hello world', 'general', Date.now(), new Date().toLocaleTimeString()]);
        console.log('INSERT succeeded');

        const saved = fs.writeFileSync('vchat_test.db', Buffer.from(db.export()));
        console.log('Saved to vchat_test.db');
    } catch (e) {
        console.log('Error:', e.message);
    }
})();
