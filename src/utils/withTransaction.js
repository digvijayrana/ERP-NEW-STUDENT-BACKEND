const mongoose = require('mongoose');

// MongoDB multi-document transactions require a replica set or mongos. On a
// standalone server (common in local/dev), starting a transaction throws
// "Transaction numbers are only allowed on a replica set member or mongos".
// We detect the topology once and fall back to running the work without a
// session so the same code path works in both environments.
let transactionsSupported = null;

async function checkTransactionsSupported() {
  if (transactionsSupported !== null) return transactionsSupported;
  try {
    const admin = mongoose.connection.db.admin();
    const info = await admin.command({ hello: 1 });
    // setName => replica set; msg 'isdbgrid' => sharded cluster (mongos)
    transactionsSupported = !!(info.setName || info.msg === 'isdbgrid');
  } catch (err) {
    transactionsSupported = false;
  }
  return transactionsSupported;
}

async function withTransaction(work) {
  const supported = await checkTransactionsSupported();
  if (!supported) {
    // Standalone MongoDB: run the work without a transaction session.
    // Passing an undefined session is a no-op for Mongoose queries.
    return work(undefined);
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = {
  withTransaction
};
