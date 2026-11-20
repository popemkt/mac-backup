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
# - Long certificate lifetimes, so a cached or resumed certificate does not
#   go stale (ERR_CERT_DATE_INVALID) while the server's chain is valid:
#   - each site's certificate lasts 825 days, the longest macOS and iOS
#     accept for any TLS server certificate, a private root's included
#     (Chrome's 398-day cap binds only publicly trusted roots). Caddy renews
#     it with a third of its lifetime left.
#   - the intermediate lasts as long as the root, less a day: ./ca.sh derives
#     the duration from the root at every start and passes it as
#     LOCAL_PROXY_INTERMEDIATE_LIFETIME. A fixed one cannot work, because
#     Caddy refuses to start when it is not shorter than the root's remaining
#     validity, which shrinks every day. The fallback below is only for Caddy
#     run without ./ca.sh; it is under the shortest root ./ca.sh keeps (365
#     days). Both keys sit on this disk, so a shorter intermediate would buy
#     nothing.
#   - Caddy renews the intermediate itself only with 5% of its lifetime left
#     (default 20%), which is past the point where ./ca.sh replaces the root
#     (a year left), so the root's replacement is the intermediate's only
#     rollover. A site certificate cannot outlive its intermediate: Caddy
#     shortens one that would, so in the root's last stretch they get
#     shorter.
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
    	tls {
    		issuer internal {
    			lifetime 825d
    		}
    	}
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
  			intermediate_lifetime {$LOCAL_PROXY_INTERMEDIATE_LIFETIME:364d}
  			renewal_window_ratio 0.05
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
