"""
load_drinks.py
--------------
Loads drinks from drinks_catalogue.json into the PostgreSQL drinks table.

Usage:
    python load_drinks.py

Before running:
    pip install psycopg2-binary --break-system-packages

Set your database connection details in the DB_CONFIG section below.
"""

import json
import psycopg2
from psycopg2.extras import execute_values


DB_CONFIG = {
    "host":     "localhost",
    "port":     5434,
    "database": "aroma_db", 
    "user":     "postgres",  
    "password": "12345" 
}


JSON_PATH = "drinks_catalogue.json"


def load_drinks():
    # Load JSON
    with open(JSON_PATH, "r") as f:
        data = json.load(f)

    drinks = data["drinks"]
    print(f"Found {len(drinks)} drinks in catalogue.")

    # Connect to PostgreSQL
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()

    # Clear existing drinks and reset IDs cleanly
    cur.execute("TRUNCATE TABLE drinks RESTART IDENTITY CASCADE;")
    print("Cleared existing drinks table.")

    # Build rows to insert
    rows = []
    for d in drinks:
        rows.append((
            d["drink_id"],
            d["name"],
            d["category"],
            d["type"],
            d["base"],
            d["caffeine_mg"],
            d["shots"],
            d["dairy_free"],
            d["vegan"],
            d["gluten_free"],
            d["milk_alternative_available"]
        ))

    # Insert all drinks
    execute_values(cur, """
        INSERT INTO drinks (
            drink_id, name, category, type, base,
            caffeine_mg, shots, dairy_free, vegan,
            gluten_free, milk_alternative_available
        ) VALUES %s
    """, rows)

    conn.commit()
    cur.close()
    conn.close()

    print(f"Successfully inserted {len(drinks)} drinks into the database.")
    for d in drinks:
        print(f"  [{d['drink_id']:>2}] {d['name']}")


if __name__ == "__main__":
    load_drinks()
