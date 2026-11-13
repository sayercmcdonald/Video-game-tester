'use strict';
/**
 * Create (or reset the password of) a studio admin.
 *   npm run create-admin -- you@example.com "Your Name"
 * The password is read from ADMIN_PASSWORD or prompted for (input hidden).
 */
const readline = require('node:readline');
const { createConfig } = require('../src/config');
const { openDb } = require('../src/db');
const { hashPassword } = require('../src/lib/crypto');

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => { if (text.includes(question)) rl.output.write(text); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

(async () => {
  const [email, name = 'Studio Admin'] = process.argv.slice(2);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Usage: npm run create-admin -- you@example.com "Your Name"');
    process.exit(1);
  }
  const password = process.env.ADMIN_PASSWORD || await promptHidden('Password (min 12 characters): ');
  if (password.length < 12) { console.error('Password must be at least 12 characters.'); process.exit(1); }
  const db = openDb(createConfig());
  const existing = db.get('SELECT id FROM users WHERE email = ?', email.toLowerCase());
  if (existing) {
    db.update('users', existing.id, { password_hash: hashPassword(password), name });
    db.run('DELETE FROM sessions WHERE user_id = ?', existing.id);
    console.log(`Password reset for ${email}. Existing sessions were signed out.`);
  } else {
    db.insert('users', { email: email.toLowerCase(), name, password_hash: hashPassword(password), created_at: new Date().toISOString() });
    console.log(`Admin ${email} created.`);
  }
  db.close();
})();
