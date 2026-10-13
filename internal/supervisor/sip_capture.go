package supervisor

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/sipcapture/gossipper/internal/sipcapture"
	"os"
	"path/filepath"
	"time"
)

func SaveCaptureConfig(dir string, cfg CaptureConfig) error {
	if cfg.RetentionDays == 0 {
		cfg.RetentionDays = 7
	}
	if cfg.RetentionDays < 1 || cfg.RetentionDays > 365 {
		return fmt.Errorf("sip_capture.retention_days must be 1..365")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	b, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "sip-capture-config.json"), b, 0600)
}
func ReadCaptureConfig(dir string) CaptureConfig {
	var cfg CaptureConfig
	b, err := os.ReadFile(filepath.Join(dir, "sip-capture-config.json"))
	if err == nil {
		_ = json.Unmarshal(b, &cfg)
	}
	if cfg.RetentionDays == 0 {
		cfg.RetentionDays = 7
	}
	return cfg
}
func CaptureExpired(j Job, now time.Time) bool {
	cfg := ReadCaptureConfig(j.ArtifactsDir)
	return cfg.Enabled && j.FinishedAt != nil && now.After(j.FinishedAt.Add(time.Duration(cfg.RetentionDays)*24*time.Hour))
}

// SweepCapture removes only expired trace directories belonging to finished jobs.
func SweepCapture(ctx context.Context, root string, store *JobsStore) {
	dirs, err := os.ReadDir(filepath.Join(root, "artifacts", "jobs"))
	if err != nil {
		return
	}
	for _, d := range dirs {
		if !d.IsDir() {
			continue
		}
		if ctx.Err() != nil {
			return
		}
		j, err := store.Get(ctx, d.Name())
		if err != nil || j.Status == StatusRunning || j.Status == StatusPending {
			continue
		}
		if CaptureExpired(j, time.Now()) {
			_ = sipcapture.Delete(filepath.Join(j.ArtifactsDir, "sip-capture"))
		}
	}
}
