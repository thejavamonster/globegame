import csv
import json
import re
import unicodedata

WORLD_FILE = "world.geojson"
CAPITALS_FILE = "country-capital-lat-long-population.csv"
OUTPUT_FILE = "capitals.js"


def normalize(text):
    text = unicodedata.normalize("NFD", text)
    text = text.encode("ascii", "ignore").decode()
    text = text.lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


REMOVE_WORDS = {
    "the",
    "republic",
    "democratic",
    "people",
    "peoples",
    "state",
    "states",
    "federation",
    "federal",
    "federated",
    "kingdom",
    "union",
    "islamic",
    "bolivarian",
    "plurinational",
    "arab",
    "of",
}


def loose_key(name):
    return " ".join(
        w for w in normalize(name).split()
        if w not in REMOVE_WORDS
    )


# Only the truly unavoidable aliases.
ALIASES = {
    "united states of america": "usa",
    "united kingdom": "england",
    "russian federation": "russia",
    "timor leste": "east timor",
    "viet nam": "vietnam",
    "republic of korea": "south korea",
    "dem peoples republic of korea": "north korea",
    "brunei darussalam": "brunei",
    "state of palestine": "west bank",
    "tfyr macedonia": "macedonia",
    "cote d ivoire": "ivory coast",
    "lao peoples democratic republic": "laos",
    "syrian arab republic": "syria",
    "the bahamas": "the bahamas",
}


# ------------------------
# Read GeoJSON
# ------------------------

with open(WORLD_FILE, encoding="utf8") as f:
    world = json.load(f)

geo_lookup = {}
geo_loose = {}

for feature in world["features"]:

    name = feature["properties"]["name"]

    n = normalize(name)

    geo_lookup[n] = n
    geo_loose[loose_key(name)] = n


# ------------------------
# Read capitals
# ------------------------

capitals = {}
unmatched = []

with open(CAPITALS_FILE, encoding="utf-8-sig") as f:

    reader = csv.DictReader(f)

    print("CSV columns:", reader.fieldnames)

    country_col = reader.fieldnames[0]
    capital_col = reader.fieldnames[1]
    lat_col = reader.fieldnames[2]
    lon_col = reader.fieldnames[3]

    for row in reader:

        csv_name = normalize(row[country_col])

        # Exact match
        if csv_name in geo_lookup:
            key = geo_lookup[csv_name]

        # Alias match
        elif csv_name in ALIASES:
            translated = ALIASES[csv_name]
            key = geo_lookup.get(translated)
        # Loose match
        else:
            key = geo_loose.get(loose_key(row[country_col]))

        if key is None:
            unmatched.append(row[country_col])
            continue

        capitals[key] = {
            "name": row[capital_col],
            "lat": float(row[lat_col]),
            "lon": float(row[lon_col]),
        }


# ------------------------
# Report missing
# ------------------------

print()
print("GeoJSON countries:", len(geo_lookup))
print("Capitals matched:", len(capitals))

print("\nMissing capitals:")

missing = []

for geo in sorted(geo_lookup):
    if geo not in capitals:
        missing.append(geo)

for m in missing:
    print(" ", m)

print("\nUnmatched CSV countries:")

for c in sorted(set(unmatched)):
    print(" ", c)


# ------------------------
# Write capitals.js
# ------------------------

with open(OUTPUT_FILE, "w", encoding="utf8") as f:

    f.write("const CAPITALS = {\n")

    first = True

    for country in sorted(capitals):

        if not first:
            f.write(",\n")

        first = False

        c = capitals[country]

        f.write(
            f'  "{country}": '
            f'{{ name: "{c["name"]}", lat: {c["lat"]}, lon: {c["lon"]} }}'
        )

    f.write("\n};\n")

print(f"\nWrote {OUTPUT_FILE}")