from math import isclose, isfinite
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from pin_art.bambu_profile import BED_DEPTH, BED_WIDTH, PRINTABLE_HEIGHT


PositiveNumber = Annotated[float, Field(gt=0, allow_inf_nan=False)]
NonnegativeNumber = Annotated[float, Field(ge=0, allow_inf_nan=False)]
GridCount = Annotated[int, Field(ge=1, le=100, strict=True)]
MaterialIndex = Annotated[int, Field(ge=0, strict=True)]
HexRGB = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
FilamentProfile = Literal["bambu-pla-basic", "bambu-pla-matte", "generic-pla"]


class DomainModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)


class Parameters(DomainModel):
    width: PositiveNumber
    depth: PositiveNumber
    thickness: PositiveNumber
    columns: GridCount
    rows: GridCount
    spacing: PositiveNumber
    diameter: PositiveNumber
    extension: PositiveNumber


class SocketParameters(DomainModel):
    insertion_depth: PositiveNumber = Field(default=2, alias="insertionDepth")
    clearance: NonnegativeNumber = 0.2


class PlateParameters(DomainModel):
    width: PositiveNumber = 256
    depth: PositiveNumber = 256


class ExportRequest(DomainModel):
    format: Literal["stl", "3mf"]
    mode: Literal["fixed", "detachable"]
    parameters: Parameters
    heights: list[PositiveNumber] = Field(max_length=10000)
    materials: list[HexRGB] = Field(min_length=1, max_length=16)
    filament_profiles: list[FilamentProfile] | None = Field(default=None, alias="filamentProfiles", min_length=1, max_length=16)
    base_material: MaterialIndex = Field(alias="baseMaterial")
    pin_materials: list[MaterialIndex] = Field(alias="pinMaterials", max_length=10000)
    socket: SocketParameters = Field(default_factory=SocketParameters)
    plate: PlateParameters = Field(default_factory=PlateParameters)

    @model_validator(mode="after")
    def validate_design(self) -> Self:
        parameters = self.parameters
        count = parameters.columns * parameters.rows
        if self.filament_profiles is not None and len(self.filament_profiles) != len(self.materials):
            raise ValueError("filamentProfiles length must match the material palette")
        if len(self.heights) != count or len(self.pin_materials) != count:
            raise ValueError("heights and pinMaterials lengths must match the grid count")
        if self.base_material >= len(self.materials) or any(index >= len(self.materials) for index in self.pin_materials):
            raise ValueError("material indices must reference the palette")
        diameter = parameters.diameter
        if self.mode == "detachable":
            diameter += self.socket.clearance
        grid_width = (parameters.columns - 1) * parameters.spacing + diameter
        grid_depth = (parameters.rows - 1) * parameters.spacing + diameter
        if not all(isfinite(value) for value in (diameter, grid_width, grid_depth)):
            raise ValueError("derived grid dimensions must be finite")
        if grid_width > parameters.width or grid_depth > parameters.depth:
            raise ValueError("pin grid must fit within the base")
        if self.format == "3mf":
            if parameters.width > BED_WIDTH or parameters.depth > BED_DEPTH:
                raise ValueError("Bambu X1C 3MF base must fit the 256 × 256 mm bed; reduce the base or export STL")
            if self.mode == "detachable" and (self.plate.width > BED_WIDTH or self.plate.depth > BED_DEPTH):
                raise ValueError("Bambu X1C 3MF usable plate dimensions must not exceed 256 × 256 mm; reduce the bed area or export STL")
            height = max(parameters.thickness, max(self.heights) + self.socket.insertion_depth) if self.mode == "detachable" else parameters.thickness + max(self.heights)
            if height > PRINTABLE_HEIGHT:
                raise ValueError("Bambu X1C 3MF parts must fit the profile's 250 mm printable height; reduce height or export STL")
        if self.mode == "fixed":
            if count > 1 and parameters.spacing < parameters.diameter:
                raise ValueError("fixed pins must not overlap")
            if self.format == "stl" and count > 1 and parameters.spacing == parameters.diameter:
                raise ValueError("fixed STL pins must have positive separation to avoid point-tangent non-manifold contact")
            if any(not isfinite(parameters.thickness + height) for height in self.heights):
                raise ValueError("assembled heights must be finite")
            return self
        floor = parameters.thickness - self.socket.insertion_depth
        if floor < 1 and not isclose(floor, 1, rel_tol=0, abs_tol=1e-12):
            raise ValueError("socket floor must be at least 1 mm")
        wall = parameters.spacing - diameter
        if count > 1 and wall < 0.8 and not isclose(wall, 0.8, rel_tol=0, abs_tol=1e-12):
            raise ValueError("wall between sockets must be at least 0.8 mm")
        for extent, dimension in [(grid_width, parameters.width), (grid_depth, parameters.depth)]:
            edge_wall = (dimension - extent) / 2
            if edge_wall < 0.8 and not isclose(edge_wall, 0.8, rel_tol=0, abs_tol=1e-12):
                raise ValueError("socket edge wall must be at least 0.8 mm")
        if any(not isfinite(height + self.socket.insertion_depth) for height in self.heights):
            raise ValueError("printed pin lengths must be finite")
        if parameters.width > self.plate.width - 10 or parameters.depth > self.plate.depth - 10:
            raise ValueError("base must fit the plate with 5 mm margins")
        if parameters.diameter > self.plate.width - 10 or parameters.diameter > self.plate.depth - 10:
            raise ValueError("pin must fit the plate with 5 mm margins")
        return self
