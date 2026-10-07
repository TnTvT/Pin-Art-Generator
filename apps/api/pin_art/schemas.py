from math import isfinite
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from pin_art.bambu_profile import BED_DEPTH, BED_WIDTH, PRINTABLE_HEIGHT
from pin_art.cross_sections import PinShape, local_bounds


MAX_PINS = 5000
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


class SlidingParameters(DomainModel):
    clearance: PositiveNumber = 0.4
    head_flare: PositiveNumber = Field(default=0.4, alias="headFlare")


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
    pins: list[PinPosition] = Field(min_length=1, max_length=MAX_PINS)
    edge_padding: NonnegativeNumber = Field(alias="edgePadding")


class ExportRequest(DomainModel):
    format: Literal["stl", "3mf"]
    mode: Literal["fixed", "print-in-place"]
    parameters: Parameters
    layout: ShapeLayout | None = Field(default=None, exclude_if=lambda value: value is None)
    heights: list[PositiveNumber] = Field(max_length=MAX_PINS)
    materials: list[HexRGB] = Field(min_length=1, max_length=16)
    filament_profiles: list[FilamentProfile] | None = Field(default=None, alias="filamentProfiles", min_length=1, max_length=16)
    base_material: MaterialIndex = Field(alias="baseMaterial")
    pin_materials: list[MaterialIndex] = Field(alias="pinMaterials", max_length=MAX_PINS)
    pin_geometries: list[PinGeometry] | None = Field(default=None, alias="pinGeometries", min_length=1, max_length=MAX_PINS, exclude_if=lambda value: value is None)
    sliding: SlidingParameters = Field(default_factory=SlidingParameters)

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
        if count > MAX_PINS:
            raise ValueError("Use at most 5,000 pins; increase spacing or reduce the base")
        if self.pin_geometries is not None and len(self.pin_geometries) != count:
            raise ValueError("pinGeometries length must match the grid count or layout pins and heights")
        if self.filament_profiles is not None and len(self.filament_profiles) != len(self.materials):
            raise ValueError("filamentProfiles length must match the material palette")
        if len(self.heights) != count or len(self.pin_materials) != count:
            raise ValueError("heights and pinMaterials lengths must match the grid count or layout pins")
        if self.base_material >= len(self.materials) or any(index >= len(self.materials) for index in self.pin_materials):
            raise ValueError("material indices must reference the palette")
        diameter = parameters.diameter
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
            if self.mode == "print-in-place" and (parameters.width > BED_WIDTH - 10 or parameters.depth > BED_DEPTH - 10):
                raise ValueError("Print-in-place 3MF must fit the bed with 5 mm margins")
            height = parameters.thickness + max(self.heights)
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
        from pin_art.sliding import validate_sliding
        from pin_art.shape_validation import _base_shape
        from shapely import box
        base = _base_shape(self) if self.layout else box(-parameters.width / 2, -parameters.depth / 2, parameters.width / 2, parameters.depth / 2)
        validate_sliding(self, base)
        if any(not isfinite(parameters.thickness + height) for height in self.heights):
            raise ValueError("printed pin lengths must be finite")
        return self
