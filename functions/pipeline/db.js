// Centralized mongoose connector for pipeline services and jobs
require('dotenv').config();

const mongoose = require('mongoose');

let connectionPromise = null;

async function connect() {
  if (mongoose.connection.readyState === 1) return mongoose;
  if (!connectionPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI missing for pipeline connection');

    connectionPromise = mongoose.connect(uri, {
      dbName: process.env.MONGODB_DB || undefined,
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 45_000,
    }).catch((err) => {
      connectionPromise = null;
      throw err;
    });
  }

  await connectionPromise;
  return mongoose;
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
    connectionPromise = null;
  }
}

module.exports = { connect, disconnect };
