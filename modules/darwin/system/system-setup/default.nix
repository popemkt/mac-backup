{
  config,
  lib,
  pkgs,
  ...
}:

let
  inherit (config.my) hostname role username;
  inherit (lib)
    attrNames
    concatMap
    concatStringsSep
    filter
    mapAttrsToList
    mkOption
    types
    ;

  componentType = types.submodule {
    options = {
      name = mkOption {
        type = types.str;
        description = "Human-readable component name.";
      };

      description = mkOption {
        type = types.str;
        description = "What the component contributes to the system.";
      };

      managedBy = mkOption {
        type = types.enum [
          "nix"
          "external"
          "hybrid"
        ];
        description = "Where the component's durable desired state is owned.";
      };
    };
  };

  connectionType = types.submodule {
    options = {
      source = mkOption {
        type = types.str;
        description = "Component initiating the relationship.";
      };

      target = mkOption {
        type = types.str;
        description = "Component receiving the relationship.";
      };
    };
  };

  integrationType = types.submodule {
    options = {
      name = mkOption {
        type = types.str;
      };

      description = mkOption {
        type = types.str;
      };

      required = mkOption {
        type = types.bool;
        default = true;
      };

      requiredBy = mkOption {
        type = types.listOf types.str;
        default = [ ];
      };

      dependsOn = mkOption {
        type = types.listOf types.str;
        default = [ ];
      };

      connection = mkOption {
        type = types.nullOr connectionType;
        default = null;
        description = "Optional source-to-target relationship this check proves.";
      };

      check = mkOption {
        type = types.attrsOf types.anything;
        description = "Pydantic-validated runtime evidence declaration.";
      };

      enrollment = mkOption {
        type = types.attrsOf types.anything;
        description = "Pydantic-validated enrollment action.";
      };

      statePaths = mkOption {
        type = types.listOf types.str;
        default = [ ];
      };

      secretPolicy = mkOption {
        type = types.str;
      };

      recovery = mkOption {
        type = types.str;
      };
    };
  };

  components = config.my.systemSetup.components;
  integrations = config.my.systemSetup.integrations;
  componentIds = attrNames components;
  integrationIds = attrNames integrations;

  idPattern = "^[a-z0-9][a-z0-9-]*$";
  invalidComponentIds = filter (id: builtins.match idPattern id == null) componentIds;
  invalidIntegrationIds = filter (id: builtins.match idPattern id == null) integrationIds;

  unknownDependencies = concatMap (
    id: filter (dependency: !builtins.hasAttr dependency integrations) integrations.${id}.dependsOn
  ) integrationIds;

  selfDependencies = filter (id: builtins.elem id integrations.${id}.dependsOn) integrationIds;

  connectionComponentIds = concatMap (
    id:
    let
      connection = integrations.${id}.connection;
    in
    if connection == null then
      [ ]
    else
      [
        connection.source
        connection.target
      ]
  ) integrationIds;

  unknownConnectionComponents = filter (id: !builtins.hasAttr id components) connectionComponentIds;

  selfConnections = filter (
    id:
    let
      connection = integrations.${id}.connection;
    in
    connection != null && connection.source == connection.target
  ) integrationIds;

  serializedComponents = mapAttrsToList (id: component: {
    inherit id;
    inherit (component) name description;
    managed_by = component.managedBy;
  }) components;

  serializedIntegrations = mapAttrsToList (id: integration: {
    inherit id;
    inherit (integration)
      name
      description
      required
      check
      enrollment
      recovery
      ;
    required_by = integration.requiredBy;
    depends_on = integration.dependsOn;
    connection =
      if integration.connection == null then
        null
      else
        {
          inherit (integration.connection) source target;
        };
    state_paths = integration.statePaths;
    secret_policy = integration.secretPolicy;
  }) integrations;

  rawManifest = pkgs.writeText "system-setup-integrations.json" (
    builtins.toJSON {
      schema_version = 2;
      host = {
        name = hostname;
        inherit role;
      };
      components = serializedComponents;
      integrations = serializedIntegrations;
    }
  );

  manifest =
    pkgs.runCommand "validated-system-setup-integrations.json"
      {
        nativeBuildInputs = [ pkgs.system-setup ];
      }
      ''
        system-setup validate-manifest --manifest ${rawManifest}
        cp ${rawManifest} "$out"
      '';
in

{
  imports = [
    ./ai.nix
    ./vpn.nix
  ];

  options.my.systemSetup = {
    components = mkOption {
      type = types.attrsOf componentType;
      default = { };
      description = "Components participating in external-state relationships.";
    };

    integrations = mkOption {
      type = types.attrsOf integrationType;
      default = { };
      description = "Evidence-backed relationships and external setup requirements.";
    };

    manifest = mkOption {
      type = types.path;
      readOnly = true;
      internal = true;
      description = "Generated, validated host integration manifest.";
    };
  };

  config = {
    my.systemSetup = {
      components."local-host" = {
        name = hostname;
        description = "This machine and its locally supervised processes.";
        managedBy = "hybrid";
      };

      inherit manifest;
    };

    assertions = [
      {
        assertion = invalidComponentIds == [ ];
        message = "System-setup component IDs must be lowercase kebab-case: ${concatStringsSep ", " invalidComponentIds}";
      }
      {
        assertion = invalidIntegrationIds == [ ];
        message = "System-setup integration IDs must be lowercase kebab-case: ${concatStringsSep ", " invalidIntegrationIds}";
      }
      {
        assertion = unknownDependencies == [ ];
        message = "System-setup dependencies refer to unknown integrations: ${concatStringsSep ", " unknownDependencies}";
      }
      {
        assertion = selfDependencies == [ ];
        message = "System-setup integrations cannot depend on themselves: ${concatStringsSep ", " selfDependencies}";
      }
      {
        assertion = unknownConnectionComponents == [ ];
        message = "System-setup connections refer to unknown components: ${concatStringsSep ", " unknownConnectionComponents}";
      }
      {
        assertion = selfConnections == [ ];
        message = "System-setup connections need distinct endpoints: ${concatStringsSep ", " selfConnections}";
      }
    ];

    environment.etc."system-setup/integrations.json".source = manifest;

    home-manager.users.${username}.home.packages = [ pkgs.system-setup ];
  };
}
