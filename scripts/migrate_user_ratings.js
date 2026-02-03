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

async function migrateUserRatings() {
  try {
    console.log('📊 Starting user ratings migration...');
    
    // Read user ratings JSON
    const ratingsData = JSON.parse(
      fs.readFileSync('C:\\Users\\lored\\FYP_REC_SYS\\user_ratings.json', 'utf8')
    );

    console.log(`Found ${ratingsData.length} ratings to migrate...`);

    let usersCreated = 0;
    let usersUpdated = 0;
    let ratingsCreated = 0;
    let errors = 0;

    for (const rating of ratingsData) {
      try {
        // Step 1: Create or update user with age_range
        const userQuery = `
          INSERT INTO users (user_id, email, display_name, created_at, age_range)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (user_id) DO UPDATE
          SET age_range = EXCLUDED.age_range
          RETURNING (xmax = 0) AS inserted
        `;
        
        const userResult = await client.query(userQuery, [
          rating.username,
          `${rating.username}@survey.com`,
          rating.username,
          rating.timestamp,
          rating.age_group  // JSON has "age_group" but we're inserting into "age_range"
        ]);

        // xmax = 0 means INSERT happened, otherwise UPDATE happened
        if (userResult.rows[0].inserted) {
          usersCreated++;
        } else {
          usersUpdated++;
        }

        // Step 2: Insert rating
        const ratingQuery = `
          INSERT INTO ratings (
            user_id, drink_id, star_rating, timestamp, mood, time_of_day, weather
          )
          SELECT $1, drink_id, $2, $3, $4, $5, $6
          FROM drinks
          WHERE name = $7
          ON CONFLICT (user_id, drink_id) DO NOTHING
          RETURNING rating_id
        `;

        const ratingResult = await client.query(ratingQuery, [
          rating.username,
          rating.rating,
          rating.timestamp,
          rating.mood,
          rating.time_of_day,
          rating.weather,
          rating.drink_name
        ]);

        if (ratingResult.rowCount > 0) {
          ratingsCreated++;
        }
      } catch (err) {
        errors++;
        console.error(`⚠️  Error with rating for drink "${rating.drink_name}" by ${rating.username}: ${err.message}`);
      }
    }

    console.log(`\n✅ Migration complete!`);
    console.log(`   👥 Users created: ${usersCreated}`);
    console.log(`   🔄 Users updated: ${usersUpdated}`);
    console.log(`   ⭐ Ratings created: ${ratingsCreated}`);
    if (errors > 0) {
      console.log(`   ⚠️  Errors encountered: ${errors}`);
    }

  } catch (error) {
    console.error('❌ Error migrating ratings:', error.message);
    throw error;
  }
}

async function verifyMigration() {
  try {
    console.log('\n🔍 Verifying migration...');
    
    // Count users
    const usersCount = await client.query('SELECT COUNT(*) FROM users');
    console.log(`   Users in database: ${usersCount.rows[0].count}`);
    
    // Count ratings
    const ratingsCount = await client.query('SELECT COUNT(*) FROM ratings');
    console.log(`   Ratings in database: ${ratingsCount.rows[0].count}`);
    
    // Show sample data
    console.log('\n📋 Sample user data:');
    const sampleUsers = await client.query('SELECT user_id, display_name, age_range FROM users LIMIT 3');
    sampleUsers.rows.forEach(user => {
      console.log(`   - ${user.display_name} (${user.user_id}): Age ${user.age_range}`);
    });
    
  } catch (error) {
    console.error('⚠️  Verification error:', error.message);
  }
}

async function main() {
  try {
    await client.connect();
    console.log('🔌 Connected to PostgreSQL database\n');

    await migrateUserRatings();
    await verifyMigration();

    await client.end();
    console.log('\n✅ All done! Database connection closed.');
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    await client.end();
    process.exit(1);
  }
}

main();
