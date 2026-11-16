{ lib }:

# The proxy's whole Caddy configuration, from the declared sites. The daemon
# (./default.nix) runs it on port 443; ./tests.nix renders the same
# function on a high port and a scratch state directory.
#
# - Loopback only: every site binds 127.0.0.1 and [::1], and nothing else.
# - No admin endpoint: Caddy runs as root, and its admin API would let any
#   local process load configuration into it.
# - Caddy's own CA ("local") signs each site's certificate under the root
#   this stack creates and owns (./ca.sh), not one Caddy would make itself,
#   and Caddy never touches a trust store: trust is a separate, explicit
#   enrollment (./system-setup.nix).
# - No HTTP listener: there is no :80 redirect; an app is only HTTPS.
# - The reverse proxy passes Host and Origin through untouched, so each app
#   applies its own guard to the address the browser used.
{
  sites,
  stateDir,
  caName,
  port ? 443,
}:
let
  site = name: target: ''
    https://${name}.localhost${lib.optionalString (port != 443) ":${toString port}"} {
    	bind 127.0.0.1 [::1]
    	tls internal
    	reverse_proxy ${target} {
    		flush_interval -1
    	}
    }
  '';
in
''
  {
  	admin off
  	persist_config off
  	auto_https disable_redirects
  	skip_install_trust
  	storage file_system ${stateDir}/caddy
  	pki {
  		ca local {
  			name "${caName}"
  			root {
  				format pem_file
  				cert ${stateDir}/ca/root.crt
  				key ${stateDir}/ca/private/root.key
  			}
  		}
  	}
  }

''
+ lib.concatStringsSep "\n" (lib.mapAttrsToList (name: s: site name s.target) sites)
