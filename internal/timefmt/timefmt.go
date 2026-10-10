// Package timefmt defines the fixed UTC+8 timezone used by user-facing timestamps.
package timefmt

import "time"

var Location = time.FixedZone("UTC+8", 8*60*60)

const Layout = "2006-01-02 15:04:05.000000000"

func Format(t time.Time) string { return t.In(Location).Format(Layout) }

// Capture converts stored timestamps. Historical zone-less records were UTC;
// new records retain an explicit offset so repeated reads never shift twice.
func Capture(value string) string {
	t, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		t, err = time.ParseInLocation("2006-01-02 15:04:05.999999999", value, time.UTC)
	}
	if err != nil {
		return value
	}
	return Format(t)
}
