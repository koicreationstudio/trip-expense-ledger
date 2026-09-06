#!/bin/sh
set -e

echo "跑数据库迁移..."
node -e "
const { migrate } = require('drizzle-orm/better-sqlite3/migrator');
const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DATABASE_PATH || '/data/db.sqlite';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
const db = drizzle(sqlite);
migrate(db, { migrationsFolder: './lib/db/migrations' });
console.log('迁移完成');
"

echo "启动 trip-expense-ledger..."
exec npm run start
