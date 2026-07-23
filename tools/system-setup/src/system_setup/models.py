from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Host(StrictModel):
    name: str
    role: Literal["personal", "work"]


class Component(StrictModel):
    id: str
    name: str
    description: str
    managed_by: Literal["nix", "external", "hybrid"]


class Connection(StrictModel):
    source: str
    target: str


class CommandCheck(StrictModel):
    kind: Literal["command"]
    argv: list[str]
    timeout_seconds: float = 30
    success_detail: str
    stdout_contains: list[str] = Field(default_factory=list)
    report_stdout: bool = True


class FileCheck(StrictModel):
    kind: Literal["file"]
    path: str
    success_detail: str


class HttpJsonCheck(StrictModel):
    kind: Literal["http_json"]
    url: str
    expected: dict[str, str]
    timeout_seconds: float = 10
    success_detail: str


class OpenAIModelsCheck(StrictModel):
    kind: Literal["openai_models"]
    url: str
    expected_models: list[str]
    timeout_seconds: float = 10


class TailscaleDeviceCheck(StrictModel):
    kind: Literal["tailscale_device"]
    executable: str = "/usr/local/bin/tailscale"


class TailscaleServiceCheck(StrictModel):
    kind: Literal["tailscale_service"]
    service: str
    target: str
    executable: str = "/usr/local/bin/tailscale"


CheckSpec = Annotated[
    CommandCheck
    | FileCheck
    | HttpJsonCheck
    | OpenAIModelsCheck
    | TailscaleDeviceCheck
    | TailscaleServiceCheck,
    Field(discriminator="kind"),
]


class Enrollment(StrictModel):
    kind: Literal["command", "manual", "none"]
    instructions: str
    argv: list[str] = Field(default_factory=list)
    url: str | None = None

    @model_validator(mode="after")
    def validate_action(self) -> Enrollment:
        if self.kind == "command" and not self.argv:
            raise ValueError("command enrollment requires argv")
        if self.kind == "manual" and self.url is None:
            raise ValueError("manual enrollment requires url")
        return self


class Integration(StrictModel):
    id: str
    name: str
    description: str
    required: bool = True
    required_by: list[str] = Field(default_factory=list)
    depends_on: list[str] = Field(default_factory=list)
    connection: Connection | None = None
    check: CheckSpec
    enrollment: Enrollment
    state_paths: list[str] = Field(default_factory=list)
    secret_policy: str
    recovery: str


class Manifest(StrictModel):
    schema_version: Literal[2]
    host: Host
    components: list[Component]
    integrations: list[Integration]

    @model_validator(mode="after")
    def validate_graph(self) -> Manifest:
        component_ids = [component.id for component in self.components]
        if len(component_ids) != len(set(component_ids)):
            raise ValueError("component IDs must be unique")

        known_components = set(component_ids)
        for integration in self.integrations:
            if integration.connection is None:
                continue
            endpoints = {
                integration.connection.source,
                integration.connection.target,
            }
            missing_components = endpoints - known_components
            if missing_components:
                names = ", ".join(sorted(missing_components))
                raise ValueError(f"{integration.id} has unknown connection components: {names}")
            if integration.connection.source == integration.connection.target:
                raise ValueError(f"{integration.id} connection endpoints must be distinct")

        identifiers = [integration.id for integration in self.integrations]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("integration IDs must be unique")

        known = set(identifiers)
        for integration in self.integrations:
            missing = set(integration.depends_on) - known
            if missing:
                names = ", ".join(sorted(missing))
                raise ValueError(f"{integration.id} has unknown dependencies: {names}")
            if integration.id in integration.depends_on:
                raise ValueError(f"{integration.id} cannot depend on itself")

        visiting: set[str] = set()
        visited: set[str] = set()
        dependencies = {integration.id: integration.depends_on for integration in self.integrations}

        def visit(identifier: str) -> None:
            if identifier in visited:
                return
            if identifier in visiting:
                raise ValueError(f"integration dependency cycle includes {identifier}")
            visiting.add(identifier)
            for dependency in dependencies[identifier]:
                visit(dependency)
            visiting.remove(identifier)
            visited.add(identifier)

        for identifier in identifiers:
            visit(identifier)
        return self


class CheckResult(StrictModel):
    id: str
    name: str
    state: Literal["ready", "action-needed", "blocked", "error"]
    required: bool
    detail: str
    required_by: list[str]
