import { db } from './services/owlfenc-db';

async function debugContracts() {
  console.log('\n=== DEBUGGING CONTRACTS ===\n');
  
  // 1. Get ALL contracts
  const allContracts = await db.collection('contracts').get();
  console.log(`Total contracts in collection: ${allContracts.size}`);
  
  // 2. Group by status
  const statusCounts: Record<string, number> = {};
  allContracts.docs.forEach(doc => {
    const status = doc.data().status || 'unknown';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });
  
  console.log('\nContracts by status:');
  Object.entries(statusCounts).forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`);
  });
  
  // 3. Try the filtered query
  const completedQuery = await db.collection('contracts')
    .where('status', 'in', ['completed', 'both_signed'])
    .get();
  
  console.log(`\nCompleted/both_signed contracts: ${completedQuery.size}`);
  
  // 4. Show first 5 contracts with details
  console.log('\nFirst 5 contracts:');
  allContracts.docs.slice(0, 5).forEach((doc, i) => {
    const data = doc.data();
    console.log(`\n${i + 1}. Contract ${doc.id}:`);
    console.log(`   Status: ${data.status}`);
    console.log(`   User: ${data.userId || data.firebaseUserId || 'N/A'}`);
    console.log(`   Created: ${data.createdAt?.toDate?.() || 'N/A'}`);
  });
  
  process.exit(0);
}

debugContracts().catch(console.error);
