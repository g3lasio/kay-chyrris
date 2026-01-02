import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const connection = await mysql.createConnection(process.env.DATABASE_URL);

console.log('Connected to database\n');

const sql = readFileSync('./drizzle/0001_special_martin_li.sql', 'utf-8');

// Split by semicolon but keep multiline statements together
const statements = [];
let currentStatement = '';
let inComment = false;

for (const line of sql.split('\n')) {
  const trimmed = line.trim();
  
  if (trimmed.startsWith('--')) {
    inComment = true;
    continue;
  }
  
  if (trimmed) {
    currentStatement += line + '\n';
  }
  
  if (trimmed.endsWith(';')) {
    statements.push(currentStatement.trim().slice(0, -1)); // Remove trailing semicolon
    currentStatement = '';
  }
}

console.log(`Found ${statements.length} SQL statements\n`);

let successCount = 0;
let skipCount = 0;

for (let i = 0; i < statements.length; i++) {
  const statement = statements[i];
  if (!statement || statement.startsWith('--')) continue;
  
  const preview = statement.substring(0, 80).replace(/\s+/g, ' ');
  
  try {
    console.log(`[${i + 1}/${statements.length}] ${preview}...`);
    await connection.execute(statement);
    console.log('    ✓ Success\n');
    successCount++;
  } catch (error) {
    if (error.message.includes('already exists')) {
      console.log(`    ⊘ Skipped (already exists)\n`);
      skipCount++;
    } else if (error.message.includes("doesn't exist")) {
      console.log(`    ⊘ Skipped (table doesn't exist yet)\n`);
      skipCount++;
    } else {
      console.error(`    ✗ Error: ${error.message}\n`);
      throw error;
    }
  }
}

await connection.end();
console.log(`\n✅ Migration completed!`);
console.log(`   Success: ${successCount}`);
console.log(`   Skipped: ${skipCount}`);
