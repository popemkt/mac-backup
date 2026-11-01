{
  config,
  lib,
  pkgs,
  ...
}:

# Sandboxes for agent work on a NixOS host: the `sandbox` bb plugin
# (assets/bb-plugins/sandbox), bubblewrap for its local provider, and the host
# policy the plugin reads, /etc/bb-sandbox/policy.json. The budget is declared
# once, here, and enforced twice from it: by the plugin's admission queue (how
# many sandboxes run, and how much CPU and memory they may ask for) and by the
# kernel, through the `sandbox.slice` user slice every capped exec runs in, so
# sandboxes together never get more than the budget, whatever they ask for.
# Design: docs/research/2026-10-31-sandboxes.md §13.
#
# A capped exec is a transient service of its person's systemd user manager,
# which must run without a login session: `people` linger. Where it does not
# run, the plugin refuses to run uncapped. Neither bb unit restarts for any of
# this; the plugin installs through bb-plugins-sync.
let
  inherit (lib) mkOption types;
  mkStack = import ../mk-stack.nix lib;
  cfg = config.my.stacks.sandboxes;

  # The same store copy bb-plugins-sync installs, so the SDK scripts import
  # is the plugin of the applied revision.
  pluginSource = import ../../common/home-manager/plugin-sources/source.nix {
    inherit lib;
    kind = "bb-plugin";
  };

  slice = "sandbox";
  policy = {
    defaultProvider = "bwrap";
    budget = { inherit (cfg.budget) sandboxes cpus memoryMiB; };
    bwrap = {
      path = lib.getExe pkgs.bubblewrap;
      # The flake's own nixpkgs (already in the system closure): `nix` images
      # build from the same revision as the host.
      nixpkgs = config.nixpkgs.flake.source;
      inherit (cfg) images;
      slice = "${slice}.slice";
    };
  };

  positive =
    default: description:
    mkOption {
      type = types.ints.positive;
      inherit default description;
    };
in
{
  options.my.stacks.sandboxes = mkStack {
    description = "sandboxes for agent work (the sandbox bb plugin, bubblewrap, a capped user slice)";
    componentOptions = {
      budget = {
        sandboxes = positive 3 "Sandboxes running at once.";
        cpus = positive 8 "Cores all sandboxes share: the queue's budget and the slice's CPUQuota.";
        memoryMiB = positive 12288 "Memory all sandboxes share, in MiB: the queue's budget and the slice's MemoryMax.";
        tasks = positive 8192 "Processes and threads all sandboxes share (the slice's TasksMax).";
      };
      people = mkOption {
        type = types.listOf types.str;
        default = [ ];
        description = "Accounts whose bb runs sandboxes. Each lingers, so its user manager (and the capped slice) runs without a login.";
      };
      images = mkOption {
        type = types.attrsOf (types.listOf types.str);
        default = {
          blender = [ "blender" ];
          browser = [ "chromium" ];
          node = [
            "nodejs_22"
            "git"
          ];
        };
        description = "Image presets: a name a spec can ask for, and the nixpkgs attributes whose bin/ go on its PATH.";
      };
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = lib.all (person: lib.elem person config.my.people) cfg.people;
        message = "my.stacks.sandboxes.people: every account must be in my.people";
      }
    ];

    my.pkgs.bbPlugins = [ "assets/bb-plugins/sandbox" ];
    environment.systemPackages = [ pkgs.bubblewrap ];

    environment.etc = {
      "bb-sandbox/policy.json".text = builtins.toJSON policy;
      # The SDK: import "/etc/bb-sandbox/plugin/sdk/index.ts".
      # The copy is rooted at the plugin's parent (it may reach siblings).
      "bb-sandbox/plugin".source = "${pluginSource ../../../assets/bb-plugins/sandbox}/sandbox";
    };

    # The ceiling over every sandbox of a person, whatever each one asks for.
    systemd.user.slices.${slice}.sliceConfig = {
      CPUQuota = "${toString (cfg.budget.cpus * 100)}%";
      MemoryMax = "${toString cfg.budget.memoryMiB}M";
      MemorySwapMax = "0";
      TasksMax = cfg.budget.tasks;
      CPUWeight = 20;
      IOWeight = 10;
    };

    users.users = lib.genAttrs cfg.people (_: {
      linger = true;
    });
  };
}
