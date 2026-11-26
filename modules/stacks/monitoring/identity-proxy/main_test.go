package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"
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
	add("100.64.0.4", "intruder@example.com")
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

	token := [2]string{"Authorization", "a-session-token"}
	for _, c := range []struct {
		name    string
		headers [][2]string
		admit   bool
	}{
		{"untagged owner", [][2]string{{"X-Forwarded-For", "100.64.0.1"}}, true},
		{"owner tag", [][2]string{{"X-Forwarded-For", "100.64.0.2"}}, true},
		{"owner tag among others", [][2]string{{"X-Forwarded-For", "100.64.0.5"}}, true},
		{"owner tag, with a token", [][2]string{{"X-Forwarded-For", "100.64.0.2"}, token}, true},
		{"other tag", [][2]string{{"X-Forwarded-For", "100.64.0.3"}}, false},
		{"other member", [][2]string{{"X-Forwarded-For", "100.64.0.4"}}, false},
		{"forged with other tag", [][2]string{{"X-Forwarded-For", "100.64.0.3"}, {"Tailscale-User-Login", "owner@example.com"}}, false},
		{"forged, no caller", [][2]string{{"Tailscale-User-Login", "owner@example.com"}}, false},
		{"token, no caller", [][2]string{token}, false},
		{"token, other tag", [][2]string{{"X-Forwarded-For", "100.64.0.3"}, token}, false},
		{"token, whois fails", [][2]string{{"X-Forwarded-For", "100.64.0.9"}, token}, false},
		{"list", [][2]string{{"X-Forwarded-For", "100.64.0.3, 100.64.0.2"}}, false},
		{"two headers", [][2]string{{"X-Forwarded-For", "100.64.0.3"}, {"X-Forwarded-For", "100.64.0.2"}}, false},
		{"funnel", [][2]string{{"X-Forwarded-For", "100.64.0.2"}, {"Tailscale-Funnel-Request", "?1"}}, false},
	} {
		got = nil
		req, _ := http.NewRequest("GET", proxy.URL+"/api/beszel/info", nil)
		for _, h := range c.headers {
			req.Header.Add(h[0], h[1])
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		resp.Body.Close()
		if !c.admit {
			if resp.StatusCode != http.StatusForbidden || got != nil {
				t.Errorf("%s: status %d, reached the hub: %v; want 403, not relayed", c.name, resp.StatusCode, got != nil)
			}
			continue
		}
		if resp.StatusCode != http.StatusOK || got == nil {
			t.Fatalf("%s: status %d, reached the hub: %v", c.name, resp.StatusCode, got != nil)
		}
		if values := got.Values(loginHeader); len(values) != 1 || values[0] != "owner@example.com" {
			t.Errorf("%s: hub got logins %q", c.name, values)
		}
		if got.Get("Tailscale-Funnel-Request") != "" {
			t.Errorf("%s: Tailscale-Funnel-Request reached the hub", c.name)
		}
	}
}

// A whois that hangs is cut off, child processes and all.
func TestWhoIsTimeout(t *testing.T) {
	script := filepath.Join(t.TempDir(), "tailscale")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nsleep 60\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	_, err := tailscaleWhoIs(script, 200*time.Millisecond)(context.Background(), netip.MustParseAddr("100.64.0.2"))
	if err == nil {
		t.Fatal("a hanging whois gave an answer")
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("a hanging whois took %v", elapsed)
	}
}
