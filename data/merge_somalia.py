import geopandas as gpd

gdf = gpd.read_file("world.geojson")

somalia_idx = gdf.index[gdf["id"] == "SOM"][0]
somaliland_idx = gdf.index[gdf["id"] == "ABV"][0]

merged = (
    gdf.loc[somalia_idx, "geometry"]
    .union(gdf.loc[somaliland_idx, "geometry"])
)

gdf.loc[somalia_idx, "geometry"] = merged

gdf = gdf.drop(somaliland_idx)

gdf.to_file("world_merged.geojson", driver="GeoJSON")