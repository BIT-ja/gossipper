package launcher

import (
	"context"
	"github.com/sipcapture/gossipper/internal/cli"
	"github.com/sipcapture/gossipper/internal/stats"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestProgressObserverReportsFinalCounters(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pause.xml")
	if err := os.WriteFile(path, []byte(`<scenario name="progress"><pause milliseconds="10"/></scenario>`), 0600); err != nil {
		t.Fatal(err)
	}
	cfg := cli.DefaultConfig()
	cfg.ScenarioFile = path
	cfg.ScenarioRole = "client"
	cfg.LocalIP = "127.0.0.1"
	cfg.LocalPort = 0
	cfg.RemoteHost = "127.0.0.1"
	cfg.RemotePort = 59999
	cfg.TotalCalls = 2
	cfg.TotalCallsSetExplicitly = true
	cfg.Rate = 100
	var final stats.Summary
	var target int
	cfg.StatsObserver = func(s stats.Summary, n int) { final = s; target = n }
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := RunSIPScenario(ctx, cfg); err != nil {
		t.Fatal(err)
	}
	if target != 2 || final.SuccessCalls != 2 || final.ActiveCalls != 0 {
		t.Fatalf("target=%d final=%+v", target, final)
	}
}
