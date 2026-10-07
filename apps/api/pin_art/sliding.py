from functools import lru_cache
from math import atan2, cos, pi, sin

import manifold3d
import numpy as np
from shapely import Point, Polygon, STRtree, prepare
from shapely.affinity import rotate, translate

from .cross_sections import polygon_vertices


def profile_points(shape, diameter, offset=0, aligned=False):
    if shape == "round":
        return np.array([[(diameter / 2 + offset) * cos(index * pi / 32), (diameter / 2 + offset) * sin(index * pi / 32)] for index in range(64)])
    vertices = polygon_vertices(shape, diameter)
    if offset == 0 and not aligned:
        return vertices
    points = []
    for index, vertex in enumerate(vertices):
        previous = vertex - vertices[index - 1]
        following = vertices[(index + 1) % len(vertices)] - vertex
        first = atan2(-previous[0], previous[1])
        last = atan2(-following[0], following[1])
        sweep = (last - first) % (2 * pi)
        steps = max(1, int(sweep * 32 / pi + 0.5))
        for step in range(steps + 1):
            angle = first + sweep * step / steps
            points.append(vertex + offset * np.array([cos(angle), sin(angle)]))
    return np.array(points)


def ring_solid(rings):
    count = len(rings[0][0])
    vertices = np.concatenate([np.column_stack([ring, np.full(count, height)]) for ring, height in rings])
    bottom_center = len(vertices)
    top_center = bottom_center + 1
    vertices = np.concatenate([vertices, [[*rings[0][0].mean(axis=0), rings[0][1]], [*rings[-1][0].mean(axis=0), rings[-1][1]]]])
    triangles = []
    for index in range(count):
        following = (index + 1) % count
        triangles.append([bottom_center, following, index])
        triangles.append([top_center, (len(rings) - 1) * count + index, (len(rings) - 1) * count + following])
        for layer in range(len(rings) - 1):
            first, second = layer * count + index, layer * count + following
            third, fourth = second + count, first + count
            triangles.extend([[first, second, third], [first, third, fourth]])
    vertices, inverse = np.unique(vertices, axis=0, return_inverse=True)
    triangles = inverse[np.array(triangles)]
    triangles = triangles[(triangles[:, 0] != triangles[:, 1]) & (triangles[:, 1] != triangles[:, 2]) & (triangles[:, 0] != triangles[:, 2])]
    return manifold3d.Manifold(manifold3d.Mesh64(vertices, triangles.astype(np.uint64)))


@lru_cache(maxsize=512)
def sliding_pin(shape, diameter, thickness, extension, clearance, flare):
    shaft = profile_points(shape, diameter, aligned=True)
    head = profile_points(shape, diameter, flare)
    length = thickness + extension
    return ring_solid([(head, 0), (shaft, flare), (shaft, length - flare), (head, length)])


@lru_cache(maxsize=128)
def guide_cutter(shape, diameter, thickness, clearance, flare):
    guide = profile_points(shape, diameter, clearance / 2)
    mouth = profile_points(shape, diameter, clearance / 2 + flare)
    return ring_solid([(mouth, -1), (mouth, 0), (guide, flare), (guide, thickness - flare), (mouth, thickness), (mouth, thickness + 1)])


def guide_base(request, placements):
    parameters = request.parameters
    thickness, flare = parameters.thickness, request.sliding.head_flare
    if request.layout:
        regions = [Polygon(region.outer, region.holes) for region in request.layout.regions]
    else:
        regions = [Polygon([[-parameters.width / 2, -parameters.depth / 2], [parameters.width / 2, -parameters.depth / 2], [parameters.width / 2, parameters.depth / 2], [-parameters.width / 2, parameters.depth / 2]])]
    tree = STRtree(regions)
    mouths = [[] for _ in regions]
    guides = [[] for _ in regions]
    profiles = {}
    for placement, geometry in zip(placements, request.resolved_pin_geometries, strict=True):
        key = (geometry.shape, geometry.rotation)
        if key not in profiles:
            angle = geometry.rotation * pi / 180
            rotation = np.array([[cos(angle), -sin(angle)], [sin(angle), cos(angle)]])
            profiles[key] = [profile_points(geometry.shape, parameters.diameter, offset) @ rotation.T for offset in (request.sliding.clearance / 2 + flare, request.sliding.clearance / 2)]
        owner = tree.query(Point(placement.x, placement.y), predicate="within")[0]
        mouth, guide = [profile + [placement.x, placement.y] for profile in profiles[key]]
        mouths[owner].append(mouth)
        guides[owner].append(guide)
    vertices, triangles = [], []
    vertex_count = 0

    def append_mesh(points, faces):
        nonlocal vertex_count
        vertices.append(points)
        triangles.append(faces + vertex_count)
        vertex_count += len(points)

    def wall(lower, bottom, upper, top, inward):
        count = len(lower)
        current = np.arange(count)
        following = (current + 1) % count
        faces = np.concatenate([np.column_stack([current, following, following + count]), np.column_stack([current, following + count, current + count])])
        if inward:
            faces = faces[:, ::-1]
        points = np.concatenate([np.column_stack([lower, np.full(count, bottom)]), np.column_stack([upper, np.full(count, top)])])
        append_mesh(points, faces)

    def oriented(ring, counterclockwise):
        points = np.asarray(ring.coords)[:-1]
        return points if ring.is_ccw == counterclockwise else points[::-1]

    for index, region in enumerate(regions):
        outer = oriented(region.exterior, True)
        holes = [oriented(ring, False) for ring in region.interiors]
        rings = [outer, *holes, *[mouth[::-1] for mouth in mouths[index]]]
        surface = np.concatenate(rings)
        faces = manifold3d.triangulate(rings)
        append_mesh(np.concatenate([np.column_stack([surface, np.zeros(len(surface))]), np.column_stack([surface, np.full(len(surface), thickness)])]), np.concatenate([faces[:, ::-1], faces + len(surface)]))
        wall(outer, 0, outer, thickness, False)
        for hole in holes:
            wall(hole[::-1], 0, hole[::-1], thickness, True)
        for mouth, guide in zip(mouths[index], guides[index], strict=True):
            wall(mouth, 0, guide, flare, True)
            wall(guide, flare, guide, thickness - flare, True)
            wall(guide, thickness - flare, mouth, thickness, True)
    points, inverse = np.unique(np.concatenate(vertices), axis=0, return_inverse=True)
    faces = inverse[np.concatenate(triangles)]
    return manifold3d.Manifold(manifold3d.Mesh64(points, faces.astype(np.uint64)))


def validate_sliding(request, base):
    parameters = request.parameters
    clearance = request.sliding.clearance / 2
    flare = request.sliding.head_flare
    if flare - clearance < 0.2 - 1e-6:
        raise ValueError("Head flare must exceed half the Sliding clearance by at least 0.2 mm")
    if parameters.thickness - 2 * flare < 1 - 1e-6:
        raise ValueError("Guide thickness must be at least 1 mm; increase base thickness or reduce Head flare")
    if any(extension < 2 * flare - 1e-6 for extension in request.heights):
        raise ValueError("Every pin extension must be at least twice the Head flare")
    prepare(base)
    padding = request.layout.edge_padding if request.layout else 0
    positions = request.layout.pins if request.layout else None
    profiles = {}
    heads, guides, mouths = [], [], []
    for index, geometry in enumerate(request.resolved_pin_geometries):
        if positions:
            horizontal, vertical = positions[index].x, positions[index].y
        else:
            row, column = divmod(index, parameters.columns)
            horizontal = (column - (parameters.columns - 1) / 2) * parameters.spacing
            vertical = (row - (parameters.rows - 1) / 2) * parameters.spacing
        key = (geometry.shape, geometry.rotation)
        if key not in profiles:
            profiles[key] = [rotate(Polygon(profile_points(geometry.shape, parameters.diameter, offset)), geometry.rotation, origin=(0, 0)) for offset in (flare, clearance, clearance + flare)]
        head, guide, mouth = [translate(profile, horizontal, vertical) for profile in profiles[key]]
        name = positions[index].id if positions else str(index + 1)
        for footprint, required, label in [(head, padding, "head Edge padding"), (guide, 0.8, "guide edge wall"), (mouth, 0.2, "mouth edge wall")]:
            if not base.covers(footprint) or footprint.distance(base.boundary) < required - 1e-6:
                raise ValueError(f"Pin {name} {label} requires {required:g} mm; increase Edge padding or base size")
        heads.append(head)
        guides.append(guide)
        mouths.append(mouth)
    tree = STRtree(mouths)
    for index, mouth in enumerate(mouths):
        for other in tree.query(mouth, predicate="dwithin", distance=0.8 + 1e-6):
            if other <= index:
                continue
            for footprints, required, label in [(heads, 0.2, "head gap"), (guides, 0.8, "guide wall"), (mouths, 0.2, "mouth wall")]:
                if footprints[index].distance(footprints[other]) < required - 1e-6:
                    raise ValueError(f"Pins {index + 1} and {other + 1} {label} must be at least {required:g} mm; increase spacing")
