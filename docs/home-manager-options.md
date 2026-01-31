# Home Manager Options Reference

Common options for `modules/home.nix`.

Full list: [home-manager options](https://nix-community.github.io/home-manager/options.xhtml)

## Packages

```nix
home.packages = with pkgs; [
  ripgrep
  fzf
  nodejs
];
```

Search packages: [search.nixos.org/packages](https://search.nixos.org/packages)

## Git

```nix
programs.git = {
  enable = true;
  userName = "Your Name";
  userEmail = "you@example.com";

  signing = {
    key = "YOUR_GPG_KEY_ID";
    signByDefault = true;
  };

  extraConfig = {
    init.defaultBranch = "main";
    pull.rebase = true;
    push.autoSetupRemote = true;
  };

  aliases = {
    s = "status";
    co = "checkout";
  };

  ignores = [
    ".DS_Store"
    "*.swp"
    ".direnv"
  ];

  delta = {
    enable = true;  # Better diffs
    options = {
      line-numbers = true;
      navigate = true;
    };
  };
};
```

## Zsh

```nix
programs.zsh = {
  enable = true;
  autosuggestion.enable = true;
  syntaxHighlighting.enable = true;

  shellAliases = {
    ll = "ls -la";
  };

  initExtra = ''
    # Custom shell code
    export MY_VAR="value"
  '';

  # Oh My Zsh (optional)
  oh-my-zsh = {
    enable = true;
    plugins = [ "git" "docker" ];
    theme = "robbyrussell";
  };

  history = {
    size = 10000;
    save = 10000;
    ignoreDups = true;
    share = true;
  };
};
```

## Neovim

```nix
programs.neovim = {
  enable = true;
  defaultEditor = true;
  viAlias = true;
  vimAlias = true;

  # Inline config
  extraLuaConfig = ''
    vim.opt.number = true
    vim.opt.relativenumber = true
  '';

  # Plugins
  plugins = with pkgs.vimPlugins; [
    telescope-nvim
    nvim-treesitter
    catppuccin-nvim
  ];
};
```

## Starship (prompt)

```nix
programs.starship = {
  enable = true;
  enableZshIntegration = true;

  settings = {
    add_newline = false;
    character = {
      success_symbol = "[➜](bold green)";
      error_symbol = "[✗](bold red)";
    };
    directory.truncation_length = 3;
    git_status.disabled = false;
  };
};
```

## Direnv

```nix
programs.direnv = {
  enable = true;
  enableZshIntegration = true;
  nix-direnv.enable = true;  # Much faster nix integration
};
```

## Tmux

```nix
programs.tmux = {
  enable = true;
  mouse = true;
  keyMode = "vi";
  terminal = "screen-256color";
  prefix = "C-a";  # Change prefix to Ctrl-a

  extraConfig = ''
    # Custom config
  '';

  plugins = with pkgs.tmuxPlugins; [
    sensible
    yank
    catppuccin
  ];
};
```

## SSH

```nix
programs.ssh = {
  enable = true;

  matchBlocks = {
    "github.com" = {
      hostname = "github.com";
      user = "git";
      identityFile = "~/.ssh/id_ed25519";
    };

    "work" = {
      hostname = "work.example.com";
      user = "myuser";
      port = 22;
    };

    "dev-*" = {
      user = "admin";
      identityFile = "~/.ssh/dev_key";
    };
  };
};
```

## Alacritty

```nix
programs.alacritty = {
  enable = true;
  settings = {
    font.size = 14;
    font.normal.family = "JetBrainsMono Nerd Font";
    window.opacity = 0.95;
    colors.primary = {
      background = "#1e1e2e";
      foreground = "#cdd6f4";
    };
  };
};
```

## File Linking

### Single file

```nix
home.file.".config/starship.toml".source = ../configs/starship.toml;
```

### Directory

```nix
home.file.".config/nvim" = {
  source = ../configs/nvim;
  recursive = true;
};
```

### Inline content

```nix
home.file.".hushlogin".text = "";

home.file.".config/app/config.json".text = builtins.toJSON {
  setting = "value";
};
```

## Environment Variables

```nix
home.sessionVariables = {
  EDITOR = "nvim";
  LANG = "en_US.UTF-8";
};
```

## Session Path

```nix
home.sessionPath = [
  "$HOME/bin"
  "$HOME/.local/bin"
  "$HOME/go/bin"
];
```
