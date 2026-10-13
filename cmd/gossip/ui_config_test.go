package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-sql-driver/mysql"
)

func writeUIConfig(t *testing.T, contents string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(p, []byte(contents), 0600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestUIConfigMySQLOverridesEnvironmentAndInherits(t *testing.T) {
	t.Setenv("GOSSIPPER_MYSQL_DSN", "stale")
	p := writeUIConfig(t, `{"http":{"listen":"0.0.0.0:18080"},"storage":{"driver":"mysql","mysql":{"host":"127.0.0.1","port":13306,"database":"test-db","username":"test","password":"p@:/),?word"}}}`)
	c, err := readUIFileConfig(p)
	if err != nil {
		t.Fatal(err)
	}
	if err = c.applyEnvironment(); err != nil {
		t.Fatal(err)
	}
	got, err := mysql.ParseDSN(os.Getenv("GOSSIPPER_MYSQL_DSN"))
	if err != nil {
		t.Fatal(err)
	}
	if got.Addr != "127.0.0.1:13306" || got.Passwd != "p@:/),?word" || got.DBName != "test-db" {
		t.Fatal("DSN fields did not roundtrip")
	}
	output, err := exec.Command("sh", "-c", `printf '%s' "$GOSSIPPER_MYSQL_DSN"`).Output()
	if err != nil || string(output) != os.Getenv("GOSSIPPER_MYSQL_DSN") {
		t.Fatal("worker environment not inherited")
	}
}

func TestUIConfigRejectsInvalidAndDoesNotLeakSecrets(t *testing.T) {
	for _, input := range []string{
		`{"storage":{"driver":"mysqll"}}`,
		`{"storage":{"driver":"mysql","mysql":{"host":"host","port":0,"username":"u","database":"db"}}}`,
		`{"storage":{"driver":"sqlite"},"http":{"listen":":65536"}}`,
		`{"storage":{"driver":"sqlite"},"unknown":"PRIVATE_SECRET"}`,
		`{"storage":{"driver":"sqlite"}} {}`,
		`{"storage":{"driver":"mysql","mysql":{"port":"PRIVATE_SECRET"}}}`,
	} {
		_, err := readUIFileConfig(writeUIConfig(t, input))
		if err == nil {
			t.Fatalf("expected rejection: %s", input)
		}
		if strings.Contains(err.Error(), "PRIVATE_SECRET") {
			t.Fatal("error leaks configuration value")
		}
	}
}

func TestUIConfigCheckOnlyAndSQLite(t *testing.T) {
	t.Setenv("GOSSIPPER_MYSQL_DSN", "stale")
	p := writeUIConfig(t, `{"storage":{"driver":"sqlite"}}`)
	if err := runUICommand([]string{"--config", p, "--check-config"}); err != nil {
		t.Fatal(err)
	}
	if os.Getenv("GOSSIPPER_MYSQL_DSN") != "stale" {
		t.Fatal("check-only changed environment")
	}
	c, err := readUIFileConfig(p)
	if err != nil {
		t.Fatal(err)
	}
	if err = c.applyEnvironment(); err != nil {
		t.Fatal(err)
	}
	if os.Getenv("GOSSIPPER_MYSQL_DSN") != "" {
		t.Fatal("explicit SQLite must clear stale MySQL setting")
	}
	if err = runUICommand([]string{"--check-config"}); err == nil {
		t.Fatal("expected missing config error")
	}
}
