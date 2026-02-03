const { Client } = require('pg');

const client = new Client({
  host: 'localhost',
  port: 5434,
  database: 'aroma_db',
  user: 'postgres',
  password: '12345'
});

async function checkData() {
  try {
    await client.connect();
    
    // Count drinks
    const drinksResult = await client.query('SELECT COUNT(*) FROM drinks');
    console.log(`✅ Total drinks in database: ${drinksResult.rows[0].count}`);
    
    // Show first 5 drinks
    const sampleDrinks = await client.query('SELECT name, category, caffeine_mg FROM drinks LIMIT 5');
    console.log('\n📋 Sample drinks:');
    sampleDrinks.rows.forEach(drink => {
      console.log(`  - ${drink.name} (${drink.category}, ${drink.caffeine_mg}mg)`);
    });
    
    await client.end();
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkData();