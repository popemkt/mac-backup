// identity-proxy: the Beszel hub's front door (../dashboard.nix). It takes
// the requests tailscaled sends to its socket (systemd's, passed as fd 3),
// tells the hub who is asking in the Tailscale-User-Login header, and
// relays them to the hub.
//
// Who is asking: tailscaled's reverse proxy sets X-Forwarded-For to the
// caller's tailnet address, after dropping any X-Forwarded-For the caller
// sent (tailscale ipn/ipnlocal/serve.go, addProxyForwardedHeaders, with
// httputil.ReverseProxy's Rewrite). Only root can open the socket, so that
// address is tailscaled's word. `tailscale whois --json <address>` names
// the device:
//
//   - untagged: its login (the hub admits only its one user);
//   - tagged with one of -owner-tags: -login;
//   - any other tag, an unknown address, a Funnel request, or anything that
//     is not one address: no identity, which the hub refuses.
//
// Whatever Tailscale-User-* headers a request carries are dropped first:
// tailscaled already drops them, and sends none for a tagged device.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/netip"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"time"
)

const loginHeader = "Tailscale-User-Login"

// The fields of tailscale's apitype.WhoIsResponse the proxy reads.
type whoIs struct {
	Node struct {
		Tags []string
	}
	UserProfile struct {
		LoginName string
	}
}

// whoIsFunc names the device at a tailnet address.
type whoIsFunc func(ctx context.Context, addr netip.Addr) (*whoIs, error)

func tailscaleWhoIs(tailscale string) whoIsFunc {
	return func(ctx context.Context, addr netip.Addr) (*whoIs, error) {
		ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		out, err := exec.CommandContext(ctx, tailscale, "whois", "--json", addr.String()).Output()
		if err != nil {
			return nil, err
		}
		var who whoIs
		if err := json.Unmarshal(out, &who); err != nil {
			return nil, err
		}
		return &who, nil
	}
}

type identity struct {
	whoIs     whoIsFunc
	login     string
	ownerTags map[string]bool
}

// callerAddr is the one address tailscaled put in X-Forwarded-For.
func callerAddr(h http.Header) (netip.Addr, error) {
	if h.Get("Tailscale-Funnel-Request") != "" {
		return netip.Addr{}, errors.New("a Funnel request")
	}
	values := h.Values("X-Forwarded-For")
	if len(values) != 1 {
		return netip.Addr{}, errors.New("not exactly one X-Forwarded-For")
	}
	addr, err := netip.ParseAddr(strings.TrimSpace(values[0]))
	if err != nil {
		return netip.Addr{}, errors.New("X-Forwarded-For is not one address")
	}
	return addr, nil
}

// login is the identity to give the hub for a request, or "".
func (id *identity) loginFor(r *http.Request) string {
	addr, err := callerAddr(r.Header)
	if err != nil {
		log.Printf("no identity: %v", err)
		return ""
	}
	who, err := id.whoIs(r.Context(), addr)
	if err != nil {
		log.Printf("no identity for %s: whois: %v", addr, err)
		return ""
	}
	if len(who.Node.Tags) == 0 {
		return who.UserProfile.LoginName
	}
	for _, tag := range who.Node.Tags {
		if id.ownerTags[tag] {
			return id.login
		}
	}
	log.Printf("no identity for %s: tags %v", addr, who.Node.Tags)
	return ""
}

func newProxy(upstream *url.URL, id *identity) *httputil.ReverseProxy {
	return &httputil.ReverseProxy{
		// Rewrite (not Director): the outbound request carries none of the
		// inbound X-Forwarded-* headers.
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(upstream)
			pr.Out.Host = pr.In.Host
			for name := range pr.Out.Header {
				if strings.HasPrefix(http.CanonicalHeaderKey(name), "Tailscale-") {
					pr.Out.Header.Del(name)
				}
			}
			if login := id.loginFor(pr.In); login != "" {
				pr.Out.Header.Set(loginHeader, login)
			}
		},
		// The hub streams live updates (server-sent events).
		FlushInterval: -1,
	}
}

func main() {
	upstream := flag.String("upstream", "", "the hub's address, host:port")
	tailscale := flag.String("tailscale", "tailscale", "the tailscale CLI")
	login := flag.String("login", "", "the identity for devices with an owner tag")
	ownerTags := flag.String("owner-tags", "", "comma-separated tags whose devices are -login")
	flag.Parse()
	if *upstream == "" || *login == "" {
		log.Fatal("-upstream and -login are required")
	}
	if os.Getenv("LISTEN_FDS") != "1" {
		log.Fatal("expects one socket from systemd (LISTEN_FDS=1)")
	}
	listener, err := net.FileListener(os.NewFile(3, "socket"))
	if err != nil {
		log.Fatal(err)
	}
	id := &identity{whoIs: tailscaleWhoIs(*tailscale), login: *login, ownerTags: map[string]bool{}}
	for _, tag := range strings.Split(*ownerTags, ",") {
		if tag != "" {
			id.ownerTags[tag] = true
		}
	}
	server := &http.Server{
		Handler:           newProxy(&url.URL{Scheme: "http", Host: *upstream}, id),
		ReadHeaderTimeout: 30 * time.Second,
	}
	log.Fatal(server.Serve(listener))
}
