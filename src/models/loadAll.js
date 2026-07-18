/**
 * Eager-load all Mongoose models so tenant proxies can wrap them
 * before controllers are required.
 */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const skip = new Set(['SchoolTenant.js', 'loadAll.js']);

for (const file of fs.readdirSync(dir)) {
  if (!file.endsWith('.js') || skip.has(file)) continue;
  require(path.join(dir, file));
}

module.exports = {};
