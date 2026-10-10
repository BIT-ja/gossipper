package timefmt

import "testing"

func TestCaptureHistoryAndOffsets(t *testing.T) {
	for _, value := range []string{"2026-10-09T20:23:39.487039783Z", "2026-10-09 20:23:39.487039783", "2026-10-10T04:23:39.487039783+08:00"} {
		if got := Capture(value); got != "2026-10-10 04:23:39.487039783" {
			t.Fatalf("%s -> %s", value, got)
		}
	}
}
