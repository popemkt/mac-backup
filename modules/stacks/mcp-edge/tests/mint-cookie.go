// mint-cookie: a genuine oauth2-proxy session cookie, for the VM test only.
//
// Built from oauth2-proxy's own source (tests.nix), it signs and encrypts a
// session for an email with a given cookie secret file, exactly as
// oauth2-proxy's cookie store does after a sign-in, and prints
// `name=value` for each cookie. With the running edge's secret, the test
// shows such a cookie opens /mcp only when it reaches oauth2-proxy directly,
// never through the front (B3).
//
//	mint-cookie <cookie secret file> <email>
package main

import (
	"fmt"
	"net/http/httptest"
	"os"
	"time"

	"github.com/oauth2-proxy/oauth2-proxy/v7/pkg/apis/options"
	"github.com/oauth2-proxy/oauth2-proxy/v7/pkg/apis/sessions"
	"github.com/oauth2-proxy/oauth2-proxy/v7/pkg/sessions/cookie"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: mint-cookie <cookie secret file> <email>")
		os.Exit(2)
	}
	opts := options.NewOptions()
	opts.Cookie.SecretFile = os.Args[1]
	store, err := cookie.NewCookieSessionStore(&opts.Session, &opts.Cookie)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	now := time.Now()
	expires := now.Add(time.Hour)
	session := &sessions.SessionState{
		CreatedAt: &now,
		ExpiresOn: &expires,
		Email:     os.Args[2],
		User:      os.Args[2],
	}
	recorder := httptest.NewRecorder()
	if err := store.Save(recorder, httptest.NewRequest("GET", "https://edge/mcp", nil), session); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	for _, c := range recorder.Result().Cookies() {
		fmt.Printf("%s=%s\n", c.Name, c.Value)
	}
}
