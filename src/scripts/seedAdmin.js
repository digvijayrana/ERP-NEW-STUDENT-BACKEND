require('dotenv').config();

const connectDb = require('../config/db');
const User = require('../models/User');

async function seedAdmin() {
  await connectDb();
  const email = process.env.ADMIN_EMAIL || 'admin@schoolerp.local';
  const password = process.env.ADMIN_PASSWORD || 'Admin@12345';
  const existing = await User.findOne({ email });

  if (existing) {
    console.log(`Admin already exists: ${email}`);
    process.exit(0);
  }

  const user = new User({
    name: process.env.ADMIN_NAME || 'System Admin',
    email,
    role: 'admin',
    passwordHash: 'pending'
  });
  await user.setPassword(password);
  await user.save();

  console.log(`Admin created: ${email}`);
  console.log(`Temporary password: ${password}`);
  process.exit(0);
}

seedAdmin().catch((error) => {
  console.error(error);
  process.exit(1);
});
