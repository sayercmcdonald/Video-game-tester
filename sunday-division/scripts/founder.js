'use strict';
/**
 * Grant, revoke or list founder access to Sunday Division Command. Founder access can only
 * be changed here (on the server) or with FOUNDER_EMAIL — never from the web.
 *
 *   npm run founder -- list
 *   npm run founder -- grant you@example.com
 *   npm run founder -- revoke someone@example.com
 *
 * When FOUNDER_EMAIL is set it is applied at every start and overrides changes made here.
 */
const { createConfig } = require('../src/config');
const { openDb } = require('../src/db');

const [cmd, email] = process.argv.slice(2);
const config = createConfig();
const db = openDb(config);
const done = (msg, code = 0) => { console.log(msg); db.close(); process.exit(code); };

if (cmd === 'list') {
  const rows = db.all('SELECT email, name FROM users WHERE founder = 1 ORDER BY id');
  done(rows.length ? rows.map((r) => `${r.email} (${r.name})`).join('\n') : 'No founder accounts.');
}
if (!['grant', 'revoke'].includes(cmd) || !email) done('Usage: npm run founder -- list | grant <email> | revoke <email>', 1);
const user = db.get('SELECT * FROM users WHERE email = ?', email.toLowerCase());
if (!user) done(`No staff account for ${email}. Create it first with npm run create-admin.`, 1);
const want = cmd === 'grant' ? 1 : 0;
db.tx(() => {
  db.run('UPDATE users SET founder = ? WHERE id = ?', want, user.id);
  if (!want) db.run("DELETE FROM sessions WHERE kind = 'founder' AND user_id = ?", user.id);
  db.insert('audit_log', { actor: 'system:cli', action: want ? 'founder.granted' : 'founder.revoked', entity: 'user', entity_id: user.id, detail: user.email, created_at: new Date().toISOString() });
});
if (config.command.founderEmails.length) console.log('Note: FOUNDER_EMAIL is set and will be re-applied at the next start.');
done(`${want ? 'Granted' : 'Revoked'} founder access for ${user.email}.${want ? '' : ' Their Command sessions were ended.'}`);
