"""Converte coordenadas WGS84 em UTM para cenários geográficos históricos."""

from functools import lru_cache
from math import floor
from pyproj import CRS, Transformer
import pyproj


@lru_cache(maxsize=120)
def _projection(epsg):
    crs = CRS.from_epsg(epsg)
    return crs, Transformer.from_crs("EPSG:4326", crs, always_xy=True)


def utm_epsg(instance):
    zone = min(60, floor((instance.depot.lng + 180) / 6) + 1)
    return (32600 if instance.depot.lat >= 0 else 32700) + zone


def projected_coordinates(instance):
    points = [instance.depot, *instance.clients]
    if getattr(instance, "coordinate_system", None) != "geographic":
        return tuple((p.x, p.y) for p in points)
    crs, transformer = _projection(utm_epsg(instance))
    area = crs.area_of_use
    if any(
        not (area.west <= p.lng <= area.east and area.south <= p.lat <= area.north)
        for p in points
    ):
        raise ValueError(
            f"Use pontos na área de {crs.name}: longitude {area.west} a {area.east}, latitude {area.south} a {area.north}. Divida cenários que cruzem essa área."
        )
    return tuple(transformer.transform(p.lng, p.lat, errcheck=True) for p in points)


def distance_metadata(instance):
    if getattr(instance, "vrp", None):
        return {
            "distance_unit": "u.d.",
            "cost_source": "vrp",
            "distance_convention": f"VRP {instance.vrp.edge_weight_type}; EUC_2D rounds to nearest integer, CEIL_2D up, FLOOR_2D down; EXACT_2D and EXPLICIT use 1000 ticks per distance unit; display coordinates do not determine costs",
        }
    if getattr(instance, "schema_version", None) == 3 and not instance.road_matrix:
        return {
            "distance_unit": "m",
            "distance_convention": "Road distances pending; no costs estimated",
            "cost_source": "pending_osrm",
        }
    if getattr(instance, "road_matrix", None):
        if instance.road_matrix.provider == "osrm":
            return {
                "distance_unit": "m",
                "distance_convention": "OSRM Table directed distances of profile-selected routes; floor(metres * 1000 + 0.5) per arc; cost_ticks / 1000 = metres",
                "cost_source": "osrm",
                "matrix_fetched_at": instance.road_matrix.fetched_at,
                "routing_endpoint": instance.road_matrix.endpoint,
            }
        return {
            "distance_unit": "m",
            "distance_convention": "Google Routes directed road matrix; integer metres per edge * 1000 ticks; no traffic; cost_ticks / 1000 = metres",
            "cost_source": "google_routes",
            "matrix_fetched_at": instance.road_matrix.fetched_at,
        }
    geographic = getattr(instance, "coordinate_system", None) == "geographic"
    return {
        "distance_unit": "m" if geographic else "u.d.",
        "distance_convention": "floor(1000 * hypot(dx, dy) + 0.5) per edge; "
        + (
            f"WGS84 projected to EPSG:{utm_epsg(instance)}; cost_ticks / 1000 = metres; Euclidean, not road distance"
            if geographic
            else "cost_ticks / 1000 = distance units; synthetic coordinates"
        ),
    }


def geographic_metadata(instance):
    if getattr(instance, "coordinate_system", None) != "geographic":
        return {}
    if getattr(instance, "schema_version", None) == 3:
        return {**distance_metadata(instance), "projection": None}
    crs, _ = _projection(utm_epsg(instance))
    return {
        **distance_metadata(instance),
        "projection": {
            "source_crs": "EPSG:4326",
            "target_crs": f"EPSG:{utm_epsg(instance)}",
            "name": crs.name,
            "pyproj_version": pyproj.__version__,
            "proj_version": pyproj.proj_version_str,
            "unit": "m",
            "points": [
                {"id": i, "easting": x, "northing": y}
                for i, (x, y) in enumerate(projected_coordinates(instance))
            ],
        },
    }
