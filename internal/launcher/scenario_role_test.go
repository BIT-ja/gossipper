package launcher

import (
	"github.com/sipcapture/gossipper/internal/cli"
	"github.com/sipcapture/gossipper/internal/scenario"
	"os"
	"path/filepath"
	"testing"
)

func TestExplicitScenarioRoleOverridesReceiveBYE(t *testing.T) {
	path := filepath.Join(t.TempDir(), "uac.xml")
	xml := `<scenario name="uac-server-bye"><send><![CDATA[INVITE sip:test@127.0.0.1 SIP/2.0
Content-Length: 0

]]></send><recv response="200"/><recv request="BYE"/><send><![CDATA[SIP/2.0 200 OK
Content-Length: 0

]]></send></scenario>`
	if err := os.WriteFile(path, []byte(xml), 0600); err != nil {
		t.Fatal(err)
	}
	for _, role := range []string{"client", "uac", "server", "uas", "", "either", "invalid"} {
		t.Run(role, func(t *testing.T) {
			cfg := cli.DefaultConfig()
			cfg.ScenarioFile = path
			cfg.ScenarioRole = role
			prepared, err := Prepare(cfg)
			if role == "invalid" {
				if err == nil {
					t.Fatal("invalid role accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			expected := scenario.ModeServer
			if role == "client" || role == "uac" || role == "" || role == "either" {
				expected = scenario.ModeClient
			}
			if prepared.EngineConfig.Scenario.Mode != expected {
				t.Fatalf("mode = %s, want %s", prepared.EngineConfig.Scenario.Mode, expected)
			}
			if expected == scenario.ModeClient && prepared.CLIConfig.ServerMode {
				t.Fatal("UAC capture incorrectly configured as server")
			}
		})
	}
}
