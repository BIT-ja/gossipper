package supervisor

import (
	"testing"
	"time"
)

func TestCaptureRetentionWithoutDiskQuota(t *testing.T) {
	dir := t.TempDir()
	if err := SaveCaptureConfig(dir, CaptureConfig{Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if got := ReadCaptureConfig(dir).RetentionDays; got != 7 {
		t.Fatal(got)
	}
	then := time.Now().Add(-8 * 24 * time.Hour)
	if !CaptureExpired(Job{ArtifactsDir: dir, FinishedAt: &then}, time.Now()) {
		t.Fatal("expected expired")
	}
	if CaptureExpired(Job{ArtifactsDir: dir}, time.Now()) {
		t.Fatal("running capture must not expire")
	}
}
