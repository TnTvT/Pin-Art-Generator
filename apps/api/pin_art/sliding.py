from functools import lru_cache
from math import atan2, cos, pi, sin, radians, tan, sqrt

import manifold3d
import numpy as np
from shapely import Point, Polygon, STRtree, prepare
from shapely.affinity import rotate, translate

from .cross_sections import polygon_vertices


def lower_taper_dimensions(clearance, flare, surface_gap, angle):
    slope = tan(radians(angle))
    facet_factor = cos(pi / 63)
    horizontal_gap = surface_gap * sqrt(1 / facet_factor ** 2 + 1 / slope ** 2)
    return horizontal_gap, (flare + horizontal_gap - clearance / 2) * slope


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
def sliding_pin(shape, diameter, thickness, extension, clearance, flare, lower_head_angle=45):
    shaft = profile_points(shape, diameter, aligned=True)
    head = profile_points(shape, diameter, flare)
    length = thickness + extension
    lower_head_height = flare * tan(radians(lower_head_angle))
    return ring_solid([(head, 0), (shaft, lower_head_height), (shaft, length - flare), (head, length)])


@lru_cache(maxsize=128)
def guide_cutter(shape, diameter, thickness, clearance, flare, surface_gap=0.3, lower_head_angle=45):
    horizontal_gap, lower_mouth_height = lower_taper_dimensions(clearance, flare, surface_gap, lower_head_angle)
    guide = profile_points(shape, diameter, clearance / 2)
    lower_mouth = profile_points(shape, diameter, flare + horizontal_gap)
    upper_mouth = profile_points(shape, diameter, clearance / 2 + flare)
    return ring_solid([(lower_mouth, -1), (lower_mouth, 0), (guide, lower_mouth_height), (guide, thickness - flare), (upper_mouth, thickness), (upper_mouth, thickness + 1)])


def guide_base(request, placements):
    parameters = request.parameters
    thickness = parameters.thickness
    upper_mouth_height = request.sliding.head_flare
    horizontal_gap, lower_mouth_height = lower_taper_dimensions(request.sliding.clearance, upper_mouth_height, request.sliding.lower_head_gap, request.sliding.lower_head_angle)
    lower_mouth_offset = upper_mouth_height + horizontal_gap
    if request.layout:
        regions = [Polygon(region.outer, region.holes) for region in request.layout.regions]
    else:
        regions = [Polygon([[-parameters.width / 2, -parameters.depth / 2], [parameters.width / 2, -parameters.depth / 2], [parameters.width / 2, parameters.depth / 2], [-parameters.width / 2, parameters.depth / 2]])]
    tree = STRtree(regions)
    lower_mouths = [[] for _ in regions]
    upper_mouths = [[] for _ in regions]
    guides = [[] for _ in regions]
    profiles = {}
    for placement, geometry in zip(placements, request.resolved_pin_geometries, strict=True):
        key = (geometry.shape, geometry.rotation)
        if key not in profiles:
            angle = geometry.rotation * pi / 180
            rotation = np.array([[cos(angle), -sin(angle)], [sin(angle), cos(angle)]])
            profiles[key] = [profile_points(geometry.shape, parameters.diameter, offset) @ rotation.T for offset in (lower_mouth_offset, request.sliding.clearance / 2 + upper_mouth_height, request.sliding.clearance / 2)]
        owner = tree.query(Point(placement.x, placement.y), predicate="within")[0]
        lower_mouth, upper_mouth, guide = [profile + [placement.x, placement.y] for profile in profiles[key]]
        lower_mouths[owner].append(lower_mouth)
        upper_mouths[owner].append(upper_mouth)
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
        for mouths, height in [(lower_mouths[index], 0), (upper_mouths[index], thickness)]:
            rings = [outer, *holes, *[mouth[::-1] for mouth in mouths]]
            surface = np.concatenate(rings)
            faces = manifold3d.triangulate(rings)
            append_mesh(np.column_stack([surface, np.full(len(surface), height)]), faces[:, ::-1] if height == 0 else faces)
        wall(outer, 0, outer, thickness, False)
        for hole in holes:
            wall(hole[::-1], 0, hole[::-1], thickness, True)
        for lower_mouth, upper_mouth, guide in zip(lower_mouths[index], upper_mouths[index], guides[index], strict=True):
            wall(lower_mouth, 0, guide, lower_mouth_height, True)
            wall(guide, lower_mouth_height, guide, thickness - upper_mouth_height, True)
            wall(guide, thickness - upper_mouth_height, upper_mouth, thickness, True)
    points, inverse = np.unique(np.concatenate(vertices), axis=0, return_inverse=True)
    faces = inverse[np.concatenate(triangles)]
    return manifold3d.Manifold(manifold3d.Mesh64(points, faces.astype(np.uint64)))


def validate_sliding(request, base):
    parameters = request.parameters
    clearance = request.sliding.clearance / 2
    flare = request.sliding.head_flare
    horizontal_gap, mouth_height = lower_taper_dimensions(request.sliding.clearance, flare, request.sliding.lower_head_gap, request.sliding.lower_head_angle)
    if flare - clearance < 0.2 - 1e-6:
        raise ValueError("Head flare must exceed half the Sliding clearance by at least 0.2 mm")
    if parameters.thickness - mouth_height - flare < 1 - 1e-6:
        raise ValueError("Guide thickness must be at least 1 mm; increase base thickness or reduce Lower taper angle, Head flare or Lower head surface gap")
    if any(extension < 2 * flare - 1e-6 for extension in request.heights):
        raise ValueError("Every pin extension must be at least twice the Head flare")
    if any(parameters.thickness + extension <= flare * tan(radians(request.sliding.lower_head_angle)) + flare for extension in request.heights):
        raise ValueError("Retaining head tapers must leave a positive shaft length; increase pin extension or reduce Lower taper angle or Head flare")
    prepare(base)
    padding = request.layout.edge_padding if request.layout else 0
    positions = request.layout.pins if request.layout else None
    profiles = {}
    heads, guides, lower_mouths, upper_mouths = [], [], [], []
    for index, geometry in enumerate(request.resolved_pin_geometries):
        if positions:
            horizontal, vertical = positions[index].x, positions[index].y
        else:
            row, column = divmod(index, parameters.columns)
            horizontal = (column - (parameters.columns - 1) / 2) * parameters.spacing
            vertical = (row - (parameters.rows - 1) / 2) * parameters.spacing
        key = (geometry.shape, geometry.rotation)
        if key not in profiles:
            profiles[key] = [rotate(Polygon(profile_points(geometry.shape, parameters.diameter, offset)), geometry.rotation, origin=(0, 0)) for offset in (flare, clearance, flare + horizontal_gap, clearance + flare)]
        head, guide, lower_mouth, upper_mouth = [translate(profile, horizontal, vertical) for profile in profiles[key]]
        name = positions[index].id if positions else str(index + 1)
        for footprint, required, label in [(head, padding, "head Edge padding"), (guide, 0.8, "guide edge wall"), (lower_mouth, 0.2, "lower mouth edge wall"), (upper_mouth, 0.2, "upper mouth edge wall")]:
            if not base.covers(footprint) or footprint.distance(base.boundary) < required - 1e-6:
                raise ValueError(f"Pin {name} {label} requires {required:g} mm; increase Edge padding or base size")
        heads.append(head)
        guides.append(guide)
        lower_mouths.append(lower_mouth)
        upper_mouths.append(upper_mouth)
    mouths = lower_mouths if horizontal_gap >= clearance else upper_mouths
    tree = STRtree(mouths)
    for index, mouth in enumerate(mouths):
        for other in tree.query(mouth, predicate="dwithin", distance=0.8 + 1e-6):
            if other <= index:
                continue
            for footprints, required, label in [(heads, 0.2, "head gap"), (guides, 0.8, "guide wall"), (lower_mouths, 0.2, "lower mouth wall"), (upper_mouths, 0.2, "upper mouth wall")]:
                if footprints[index].distance(footprints[other]) < required - 1e-6:
                    raise ValueError(f"Pins {index + 1} and {other + 1} {label} must be at least {required:g} mm; increase spacing")
