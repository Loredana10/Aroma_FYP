"""
import_mood_ratings.py
---------------------
Imports the second survey (with mood + time_of_day) into the ratings table.

These respondents are NEW users not in the database yet, so the script:
  1. Creates a new user row for each survey respondent
  2. Inserts their ratings with mood and time_of_day populated
  3. Uses ON CONFLICT to safely re-run without duplicates

Usage:
    python import_mood_ratings.py
"""

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
import uuid

DB_CONFIG = {
    "host":     "localhost",
    "port":     5434,
    "database": "aroma_db",
    "user":     "postgres",
    "password": "12345"
}

CSV_PATH = "ratings_improved.csv"

# Drinks in the database — maps survey column name (stripped) → db name
# Handles the Irish Tea rename and strips whitespace from column names
DRINK_NAME_MAP = {
    'Mocha':                    'Mocha',
    'Soy Milk Latte':           'Soy Milk Latte',
    'Decaf Cappuccino':         'Decaf Cappuccino',
    'Decaf Latte':              'Decaf Latte',
    'Turkish Coffee':           'Turkish Coffee',
    'Pour Over':                'Pour Over',
    'Pumpkin Spice Latte':      'Pumpkin Spice Latte',
    'Salted Caramel Latte':     'Salted Caramel Latte',
    'Vanilla Latte':            'Vanilla Latte',
    'Caramel Latte':            'Caramel Latte',
    'Gingerbread Latte':        'Gingerbread Latte',
    'Hazelnut Latte':           'Hazelnut Latte',
    'Peppermint Tea':           'Peppermint Tea',
    'Ginger Tea':               'Ginger Tea',
    'Lavender Tea':             'Lavender Tea',
    'Hibiscus Tea':             'Hibiscus Tea',
    'Irish Tea (without milk)': 'Irish Tea',
    'Irish Tea (with Milk)':    'Irish Tea with Milk',
    'Almond Milk Cappuccino':   'Almond Milk Cappuccino',
}

AGE_RANGE_MAP = {
    'Under 18':  'Under 18',
    '18 - 24':   '18-24',
    '25 - 34':   '25-34',
    '35 - 44':   '35-44',
    '45 - 54':   '45-54',
    '55+':       '55+',
}

def import_ratings():
    df = pd.read_csv(CSV_PATH)
    print(f"Loaded {len(df)} respondents")

    conn = psycopg2.connect(**DB_CONFIG)
    cur  = conn.cursor()

    # Get drink name → drink_id from DB
    cur.execute("SELECT drink_id, name FROM drinks")
    drink_map = {row[1]: row[0] for row in cur.fetchall()}

    # Identify triplets: (drink_col, time_col, mood_col)
    # The CSV is structured as: drink, time, mood, drink, time, mood ...
    meta_cols = {'Timestamp', 'What is your age?', 'What is your gender?'}
    cols = [c for c in df.columns if c not in meta_cols]

    triplets = []
    i = 0
    while i < len(cols):
        drink_col = cols[i]
        if i + 2 < len(cols):
            time_col = cols[i + 1]
            mood_col = cols[i + 2]
            triplets.append((drink_col, time_col, mood_col))
            i += 3
        else:
            i += 1

    print(f"Found {len(triplets)} drink triplets")

    # Create a new user per respondent and collect ratings
    user_rows  = []
    rating_rows = []

    for idx, row in df.iterrows():
        # Generate a unique synthetic user_id for this survey respondent
        user_id     = f"survey2_{uuid.uuid4().hex[:12]}"
        age_raw     = str(row.get('What is your age?', '')).strip()
        gender_raw  = str(row.get('What is your gender?', '')).strip()
        age_range   = AGE_RANGE_MAP.get(age_raw, age_raw)
        email       = f"{user_id}@survey2.com"
        display_name = user_id

        user_rows.append((user_id, email, display_name, age_range, gender_raw))

        for drink_col, time_col, mood_col in triplets:
            rating_val = row.get(drink_col)
            if pd.isna(rating_val):
                continue

            try:
                rating = int(float(rating_val))
            except (ValueError, TypeError):
                continue

            if rating < 1 or rating > 5:
                continue

            # Clean drink name — strip whitespace and newlines
            drink_name_clean = drink_col.strip().replace('\n', '')
            # Apply name overrides for renamed drinks
            db_name = DRINK_NAME_MAP.get(drink_name_clean, drink_name_clean)
            if db_name is None:
                continue  # skip drinks not in DB

            drink_id = drink_map.get(db_name)
            if not drink_id:
                # Try the cleaned name directly
                drink_id = drink_map.get(drink_name_clean)
            if not drink_id:
                print(f"  ⚠️  Could not find drink: '{drink_name_clean}' (mapped to '{db_name}')")
                continue

            time_of_day = row.get(time_col)
            mood        = row.get(mood_col)
            time_of_day = str(time_of_day).strip() if pd.notna(time_of_day) else None
            mood        = str(mood).strip()        if pd.notna(mood)        else None

            rating_rows.append((user_id, drink_id, rating, mood, time_of_day))

    print(f"Prepared {len(user_rows)} users and {len(rating_rows)} ratings")

    # Insert users
    execute_values(cur, """
        INSERT INTO users (user_id, email, display_name, age_range, gender, created_at)
        VALUES %s
        ON CONFLICT (user_id) DO NOTHING
    """, [(u[0], u[1], u[2], u[3], u[4]) for u in user_rows],
    template="(%s, %s, %s, %s, %s, NOW())")

    print(f"✅ Inserted {len(user_rows)} users")

    # Insert ratings
    execute_values(cur, """
        INSERT INTO ratings (user_id, drink_id, star_rating, mood, time_of_day, timestamp)
        VALUES %s
        ON CONFLICT (user_id, drink_id)
        DO UPDATE SET
            star_rating = EXCLUDED.star_rating,
            mood        = EXCLUDED.mood,
            time_of_day = EXCLUDED.time_of_day,
            timestamp   = NOW()
    """, [(r[0], r[1], r[2], r[3], r[4]) for r in rating_rows],
    template="(%s, %s, %s, %s, %s, NOW())")

    conn.commit()
    cur.close()
    conn.close()

    print(f"✅ Imported {len(rating_rows)} ratings with mood and time_of_day")

    # Preview averages
    conn2 = psycopg2.connect(**DB_CONFIG)
    cur2  = conn2.cursor()
    cur2.execute("""
        SELECT d.name,
               ROUND(AVG(r.star_rating)::numeric, 2) as avg,
               COUNT(*) as total,
               COUNT(r.mood) as with_mood
        FROM ratings r
        JOIN drinks d ON r.drink_id = d.drink_id
        GROUP BY d.name
        ORDER BY avg DESC
        LIMIT 10
    """)
    print("\nTop 10 drinks by average rating:")
    print(f"{'Drink':<30} {'Avg':>5}  {'Total':>6}  {'With mood':>9}")
    print("-" * 55)
    for name, avg, total, with_mood in cur2.fetchall():
        print(f"{name:<30} {float(avg):>5.2f}  {total:>6}  {with_mood:>9}")
    cur2.close()
    conn2.close()


if __name__ == "__main__":
    import_ratings()