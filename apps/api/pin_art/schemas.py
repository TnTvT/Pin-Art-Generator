from math import isclose, isfinite
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from pin_art.bambu_profile import BED_DEPTH, BED_WIDTH, PRINTABLE_HEIGHT
from pin_art.cross_sections import PinShape, local_bounds


PositiveNumber = Annotated[float, Field(gt=0, allow_inf_nan=False)]
NonnegativeNumber = Annotated[float, Field(ge=0, allow_inf_nan=False)]
GridCount = Annotated[int, Field(ge=1, le=100, strict=True)]
MaterialIndex = Annotated[int, Field(ge=0, strict=True)]
HexRGB = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
FilamentProfile = Literal["bambu-pla-basic", "bambu-pla-matte", "generic-pla"]


class DomainModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)


class PinGeometry(DomainModel):
    shape: PinShape
    rotation: Annotated[float, Field(ge=0, le=360, allow_inf_nan=False)]

    @model_validator(mode="after")
    def canonical_rotation(self) -> Self:
        self.rotation = self.rotation % 360 if self.shape != "round" else 0
        return self


class Parameters(DomainModel):
    width: PositiveNumber
    depth: PositiveNumber
    thickness: PositiveNumber
    columns: GridCount | None = None
    rows: GridCount | None = None
    spacing: PositiveNumber
    diameter: PositiveNumber
    extension: PositiveNumber
    pin_shape: PinShape = Field(default="round", alias="pinShape", exclude_if=lambda value: value == "round")
    pin_rotation: Annotated[float, Field(ge=0, le=360, allow_inf_nan=False)] = Field(default=0, alias="pinRotation", exclude_if=lambda value: value == 0)

    @field_validator("pin_rotation")
    @classmethod
    def canonical_rotation(cls, value: float) -> float:
        return value % 360


class SocketParameters(DomainModel):
    insertion_depth: PositiveNumber = Field(default=2, alias="insertionDepth")
    clearance: NonnegativeNumber = 0.2


class PlateParameters(DomainModel):
    width: PositiveNumber = 256
    depth: PositiveNumber = 256


Coordinate = Annotated[float, Field(allow_inf_nan=False)]
PointCoordinates = Annotated[list[Coordinate], Field(min_length=2, max_length=2)]
Ring = Annotated[list[PointCoordinates], Field(min_length=3, max_length=20000)]


class BaseRegion(DomainModel):
    outer: Ring
    holes: list[Ring] = Field(default_factory=list, max_length=6666)


class PinPosition(DomainModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9:_-]+$")
    x: Coordinate
    y: Coordinate


class ShapeLayout(DomainModel):
    regions: list[BaseRegion] = Field(min_length=1, max_length=6666)
    pins: list[PinPosition] = Field(min_length=1, max_length=10000)
    edge_padding: NonnegativeNumber = Field(alias="edgePadding")


class ExportRequest(DomainModel):
    format: Literal["stl", "3mf"]
    mode: Literal["fixed", "detachable"]
    parameters: Parameters
    layout: ShapeLayout | None = Field(default=None, exclude_if=lambda value: value is None)
    heights: list[PositiveNumber] = Field(max_length=10000)
    materials: list[HexRGB] = Field(min_length=1, max_length=16)
    filament_profiles: list[FilamentProfile] | None = Field(default=None, alias="filamentProfiles", min_length=1, max_length=16)
    base_material: MaterialIndex = Field(alias="baseMaterial")
    pin_materials: list[MaterialIndex] = Field(alias="pinMaterials", max_length=10000)
    pin_geometries: list[PinGeometry] | None = Field(default=None, alias="pinGeometries", min_length=1, max_length=10000, exclude_if=lambda value: value is None)
    socket: SocketParameters = Field(default_factory=SocketParameters)
    plate: PlateParameters = Field(default_factory=PlateParameters)

    @field_validator("pin_geometries", mode="before")
    @classmethod
    def require_geometry_array(cls, value):
        if value is None:
            raise ValueError("pinGeometries must be a complete array when present")
        return value

    @property
    def resolved_pin_geometries(self) -> list[PinGeometry]:
        if self.pin_geometries is not None:
            return self.pin_geometries
        count = len(self.heights)
        geometry = PinGeometry(shape=self.parameters.pin_shape, rotation=self.parameters.pin_rotation)
        return [geometry] * count

    @model_validator(mode="after")
    def validate_design(self) -> Self:
        parameters = self.parameters
        if self.layout is None and (parameters.columns is None or parameters.rows is None):
            raise ValueError("rows and columns are required for legacy requests without layout")
        count = len(self.layout.pins) if self.layout else parameters.columns * parameters.rows
        if self.pin_geometries is not None and len(self.pin_geometries) != count:
            raise ValueError("pinGeometries length must match the grid count or layout pins and heights")
        if self.filament_profiles is not None and len(self.filament_profiles) != len(self.materials):
            raise ValueError("filamentProfiles length must match the material palette")
        if len(self.heights) != count or len(self.pin_materials) != count:
            raise ValueError("heights and pinMaterials lengths must match the grid count or layout pins")
        if self.base_material >= len(self.materials) or any(index >= len(self.materials) for index in self.pin_materials):
            raise ValueError("material indices must reference the palette")
        diameter = parameters.diameter
        if self.mode == "detachable":
            diameter += self.socket.clearance
        grid_width = parameters.width if self.layout else (parameters.columns - 1) * parameters.spacing + diameter
        grid_depth = parameters.depth if self.layout else (parameters.rows - 1) * parameters.spacing + diameter
        polygon = parameters.pin_shape != "round" or self.pin_geometries is not None
        pin_bounds = local_bounds(parameters.pin_shape, parameters.diameter, parameters.pin_rotation)
        if self.pin_geometries is not None:
            grid_width, grid_depth = parameters.width, parameters.depth
        elif polygon and not self.layout:
            grid_width = (parameters.columns - 1) * parameters.spacing + 2 * max(abs(pin_bounds[0]), abs(pin_bounds[2]))
            grid_depth = (parameters.rows - 1) * parameters.spacing + 2 * max(abs(pin_bounds[1]), abs(pin_bounds[3]))
        if not all(isfinite(value) for value in (diameter, grid_width, grid_depth)):
            raise ValueError("derived grid dimensions must be finite")
        if grid_width > parameters.width + (1e-6 if polygon else 0) or grid_depth > parameters.depth + (1e-6 if polygon else 0):
            raise ValueError("pin grid must fit within the base")
        if self.layout:
            from pin_art.shape_validation import validate_shape_layout
            validate_shape_layout(self)
        elif polygon:
            from pin_art.shape_validation import validate_polygon_layout
            validate_polygon_layout(self)
        if self.format == "3mf":
            if parameters.width > BED_WIDTH or parameters.depth > BED_DEPTH:
                raise ValueError("Bambu X1C 3MF base must fit the 256 × 256 mm bed; reduce the base or export STL")
            if self.mode == "detachable" and (self.plate.width > BED_WIDTH or self.plate.depth > BED_DEPTH):
                raise ValueError("Bambu X1C 3MF usable plate dimensions must not exceed 256 × 256 mm; reduce the bed area or export STL")
            height = max(parameters.thickness, max(self.heights) + self.socket.insertion_depth) if self.mode == "detachable" else parameters.thickness + max(self.heights)
            if height > PRINTABLE_HEIGHT:
                raise ValueError("Bambu X1C 3MF parts must fit the profile's 250 mm printable height; reduce height or export STL")
        if self.mode == "fixed":
            if not self.layout and not polygon and count > 1 and parameters.spacing < parameters.diameter:
                raise ValueError("fixed pins must not overlap")
            if not self.layout and not polygon and self.format == "stl" and count > 1 and parameters.spacing == parameters.diameter:
                raise ValueError("fixed STL pins must have positive separation to avoid point-tangent non-manifold contact")
            if any(not isfinite(parameters.thickness + height) for height in self.heights):
                raise ValueError("assembled heights must be finite")
            return self
        floor = parameters.thickness - self.socket.insertion_depth
        if floor < 1 and not isclose(floor, 1, rel_tol=0, abs_tol=1e-12):
            raise ValueError("socket floor must be at least 1 mm")
        wall = parameters.spacing - diameter
        if not self.layout and not polygon and count > 1 and wall < 0.8 and not isclose(wall, 0.8, rel_tol=0, abs_tol=1e-12):
            raise ValueError("wall between sockets must be at least 0.8 mm")
        for extent, dimension in ([] if self.layout or polygon else [(grid_width, parameters.width), (grid_depth, parameters.depth)]):
            edge_wall = (dimension - extent) / 2
            if edge_wall < 0.8 and not isclose(edge_wall, 0.8, rel_tol=0, abs_tol=1e-12):
                raise ValueError("socket edge wall must be at least 0.8 mm")
        if any(not isfinite(height + self.socket.insertion_depth) for height in self.heights):
            raise ValueError("printed pin lengths must be finite")
        if parameters.width > self.plate.width - 10 or parameters.depth > self.plate.depth - 10:
            raise ValueError("base must fit the plate with 5 mm margins")
        for geometry in self.resolved_pin_geometries:
            bounds = local_bounds(geometry.shape, parameters.diameter, geometry.rotation)
            if bounds[2] - bounds[0] > self.plate.width - 10 or bounds[3] - bounds[1] > self.plate.depth - 10:
                raise ValueError("pin must fit the plate with 5 mm margins")
        return self
