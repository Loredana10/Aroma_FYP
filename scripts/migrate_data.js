const fs = require('fs');
const { Client } = require('pg');

// Database connection
const client = new Client({
  host: 'localhost',
  port: 5434,
  database: 'aroma_db',
  user: 'postgres',
  password: '12345'
});

async function migrateDrinks() {
  try {
    // Read drinks catalogue
    const fileData = JSON.parse(
      fs.readFileSync('C:\\Users\\lored\\FYP_REC_SYS\\drinks_catalogue.json', 'utf8')
    );
    
    // Extract the drinks array from the structure
    const drinksData = fileData.drinks;  // Changed this line!

    console.log(`Found ${drinksData.length} drinks to migrate...`);

    // Insert each drink
    for (const drink of drinksData) {
      const query = `
        INSERT INTO drinks (
          drink_id, name, category, type, base, caffeine_mg, shots, 
          dairy_free, vegan, gluten_free, milk_alternative_available
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (name) DO NOTHING
      `;

      const values = [
        drink.drink_id,
        drink.name,
        drink.category,
        drink.type,
        drink.base,
        drink.caffeine_mg,
        drink.shots,
        drink.dairy_free,
        drink.vegan,
        drink.gluten_free,
        drink.milk_alternative_available || false  // Add default value
      ];

      await client.query(query, values);
    }

    console.log('✅ Drinks migrated successfully!');
  } catch (error) {
    console.error('❌ Error migrating drinks:', error);
  }
}

async function main() {
  try {
    await client.connect();
    console.log('📊 Connected to PostgreSQL database');

    await migrateDrinks();
    await migrateUserRatings();

    await client.end();
    console.log('✅ All data migrated successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
  }
}

main();