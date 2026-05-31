const initSqlJs = require('sql.js');
const fs = require('fs');
(async () => {
    const SQL = await initSqlJs();
    const data = fs.readFileSync('vchat.db');
    const db = new SQL.Database(data);
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    console.log('Tables:', JSON.stringify(tables, null, 2));
    const users = db.exec('SELECT username, role FROM users');
    console.log('Users:', JSON.stringify(users, null, 2));
    const msgs = db.exec('SELECT COUNT(*) as cnt FROM messages');
    console.log('Message count:', JSON.stringify(msgs, null, 2));
})();
