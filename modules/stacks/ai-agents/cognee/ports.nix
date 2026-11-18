lib: {
  mcpPort = lib.mkOption {
    type = lib.types.port;
    readOnly = true;
    default = 8001;
    description = "Loopback MCP port shared by the mutually exclusive Cognee roles.";
  };
  gatewayPort = lib.mkOption {
    type = lib.types.port;
    readOnly = true;
    default = 8088;
    description = "HTTP port of the Cognee server gateway.";
  };
}
