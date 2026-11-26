package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"testing"
)

func TestIdentity(t *testing.T) {
	peers := map[string]*whoIs{}
	add := func(addr, login string, tags ...string) {
		w := &whoIs{}
		w.Node.Tags = tags
		w.UserProfile.LoginName = login
		peers[addr] = w
	}
	add("100.64.0.1", "owner@example.com")
	add("100.64.0.2", "tagged-devices", "tag:personal-device")
	add("100.64.0.3", "tagged-devices", "tag:shared-server")
	add("100.64.0.5", "tagged-devices", "tag:shared-server", "tag:personal-device")
	id := &identity{
		whoIs: func(_ context.Context, a netip.Addr) (*whoIs, error) {
			if w, ok := peers[a.String()]; ok {
				return w, nil
			}
			return nil, errors.New("no such peer")
		},
		login:     "owner@example.com",
		ownerTags: map[string]bool{"tag:personal-device": true},
	}

	var got http.Header
	hub := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { got = r.Header.Clone() }))
	defer hub.Close()
	upstream, _ := url.Parse(hub.URL)
	proxy := httptest.NewServer(newProxy(upstream, id))
	defer proxy.Close()

	for _, c := range []struct {
		name    string
		headers [][2]string
		want    string
	}{
		{"untagged owner", [][2]string{{"X-Forwarded-For", "100.64.0.1"}}, "owner@example.com"},
		{"owner tag", [][2]string{{"X-Forwarded-For", "100.64.0.2"}}, "owner@example.com"},
		{"owner tag among others", [][2]string{{"X-Forwarded-For", "100.64.0.5"}}, "owner@example.com"},
		{"other tag", [][2]string{{"X-Forwarded-For", "100.64.0.3"}}, ""},
		{"forged with other tag", [][2]string{{"X-Forwarded-For", "100.64.0.3"}, {"Tailscale-User-Login", "owner@example.com"}}, ""},
		{"forged, no caller", [][2]string{{"Tailscale-User-Login", "owner@example.com"}}, ""},
		{"unknown", [][2]string{{"X-Forwarded-For", "100.64.0.9"}}, ""},
		{"list", [][2]string{{"X-Forwarded-For", "100.64.0.3, 100.64.0.2"}}, ""},
		{"two headers", [][2]string{{"X-Forwarded-For", "100.64.0.3"}, {"X-Forwarded-For", "100.64.0.2"}}, ""},
		{"funnel", [][2]string{{"X-Forwarded-For", "100.64.0.2"}, {"Tailscale-Funnel-Request", "?1"}}, ""},
	} {
		req, _ := http.NewRequest("GET", proxy.URL+"/api/beszel/info", nil)
		for _, h := range c.headers {
			req.Header.Add(h[0], h[1])
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		resp.Body.Close()
		if login := got.Get(loginHeader); login != c.want {
			t.Errorf("%s: hub got login %q, want %q", c.name, login, c.want)
		}
		if values := got.Values(loginHeader); len(values) > 1 {
			t.Errorf("%s: hub got %d login headers", c.name, len(values))
		}
		if got.Get("Tailscale-Funnel-Request") != "" {
			t.Errorf("%s: Tailscale-Funnel-Request reached the hub", c.name)
		}
	}
}
