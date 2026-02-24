"""
import_survey_ratings.py
------------------------
Imports ratings from the Coffee and Tea Ratings survey CSV into PostgreSQL.

- Reads the wide-format survey (one row per respondent, one column per drink)
- Maps survey usernames to user_ids in the users table
- Only imports ratings for drinks that exist in the database
- Skips drinks not in the database (Vienna Coffee, Irish Coffee)
- Safe to run multiple times — uses ON CONFLICT to avoid duplicates

Usage:
    python import_survey_ratings.py

Place this file in the same folder as your CSV, or update CSV_PATH below.
"""

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

# ─── CONFIG ───────────────────────────────────────────────────────────────────
DB_CONFIG = {
    "host":     "localhost",
    "port":     5434,
    "database": "aroma_db",  
    "user":     "postgres",
    "password": "12345"  
}

CSV_PATH = "ratings.csv"

# ─── DRINKS IN THE DATABASE (51 drinks) ───────────────────────────────────────
DB_DRINKS = [
    'Espresso','Double Espresso','Americano','Cappuccino','Latte','Flat White',
    'Macchiato','Cortado','Affogato','Mocha','Oat Milk Latte','Almond Milk Latte',
    'Soy Milk Latte','Coconut Milk Latte','Oat Milk Americano','Almond Milk Americano',
    'Soy Milk Americano','Coconut Milk Americano','Oat Milk Cappuccino',
    'Almond Milk Cappuccino','Soy Milk Cappuccino','Coconut Milk Cappuccino',
    'Iced Americano','Iced Latte','Iced Vanilla Latte','Iced Caramel Latte',
    'Cold Brew','Decaf Americano','Decaf Espresso','Decaf Cappuccino','Decaf Latte',
    'Decaf Flat White','Turkish Coffee','Pour Over','Pumpkin Spice Latte',
    'Salted Caramel Latte','Vanilla Latte','Caramel Latte','Gingerbread Latte',
    'Hazelnut Latte','Matcha Latte','Chai Latte','Peppermint Latte','Dirty Chai',
    'Chamomile Tea','Peppermint Tea','Ginger Tea','Lavender Tea','Hibiscus Tea',
    'Irish Tea','Irish Tea with Milk'
]

# ──────────────────────────────────────────────────────────────────────────────

def import_ratings():
    # Load CSV
    df = pd.read_csv(CSV_PATH)
    print(f"Loaded {len(df)} survey respondents")

    # Connect to PostgreSQL
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()

    # Get drink name → drink_id mapping from database
    cur.execute("SELECT drink_id, name FROM drinks")
    drink_map = {row[1]: row[0] for row in cur.fetchall()}
    print(f"Found {len(drink_map)} drinks in database")

    # Get username → user_id mapping from database
    cur.execute("SELECT user_id, display_name FROM users")
    user_map = {row[1]: row[0] for row in cur.fetchall()}
    print(f"Found {len(user_map)} users in database")

    # Identify drink columns (skip metadata columns)
    skip = ['Timestamp', 'What is your age?', 'What is your gender?']
    time_cols = [c for c in df.columns if 'time of day' in c.lower() or 'Question Type' in c]
    drink_cols = [c for c in df.columns if c not in skip and c not in time_cols]

    # Build ratings rows
    rows = []
    skipped_drinks = set()
    skipped_users = 0
    
    for _, row in df.iterrows():
        # Survey username is stored as display_name in the users table
        # The survey has no username column — use row index as surrogate user
        # Map by position: survey row 0 = first user in users table by created_at
        pass

    # Better approach: map by survey row order to user_ids
    # Get survey users ordered by created_at
    cur.execute("""
        SELECT user_id FROM users 
        WHERE email LIKE '%@survey.com'
        ORDER BY created_at ASC
    """)
    survey_user_ids = [row[0] for row in cur.fetchall()]
    print(f"Found {len(survey_user_ids)} survey users in database")

    rows = []
    matched_rows = min(len(df), len(survey_user_ids))
    
    for i in range(matched_rows):
        survey_row = df.iloc[i]
        user_id = survey_user_ids[i]

        for col in drink_cols:
            drink_name = col.strip()
            
            # Skip drinks not in database
            if drink_name not in DB_DRINKS:
                skipped_drinks.add(drink_name)
                continue

            # Skip if no rating given
            val = survey_row[col]
            if pd.isna(val):
                continue

            try:
                rating = int(float(val))
            except (ValueError, TypeError):
                continue

            # Validate rating range
            if rating < 1 or rating > 5:
                continue

            drink_id = drink_map.get(drink_name)
            if not drink_id:
                continue

            rows.append((user_id, drink_id, rating))

    print(f"Prepared {len(rows)} ratings to insert")
    if skipped_drinks:
        print(f"Skipped drinks (not in DB): {skipped_drinks}")

    if not rows:
        print("No ratings to insert.")
        return

    # Insert with ON CONFLICT — safe to re-run
    execute_values(cur, """
        INSERT INTO ratings (user_id, drink_id, star_rating, timestamp)
        VALUES %s
        ON CONFLICT (user_id, drink_id)
        DO UPDATE SET
            star_rating = EXCLUDED.star_rating,
            timestamp   = NOW()
    """, [(r[0], r[1], r[2], ) for r in rows],
    template="(%s, %s, %s, NOW())")

    conn.commit()
    cur.close()
    conn.close()

    print(f"\n✅ Successfully imported {len(rows)} ratings into the database.")

    # Print a quick average per drink preview
    print("\nSample averages (first 10 drinks):")
    conn2 = psycopg2.connect(**DB_CONFIG)
    cur2 = conn2.cursor()
    cur2.execute("""
        SELECT d.name, ROUND(AVG(r.star_rating)::numeric, 2) as avg, COUNT(*) as count
        FROM ratings r
        JOIN drinks d ON r.drink_id = d.drink_id
        GROUP BY d.name
        ORDER BY avg DESC
        LIMIT 10
    """)
    for name, avg, count in cur2.fetchall():
        print(f"  {name:<30} avg: {avg}  ({count} ratings)")
    cur2.close()
    conn2.close()


if __name__ == "__main__":
    import_ratings()