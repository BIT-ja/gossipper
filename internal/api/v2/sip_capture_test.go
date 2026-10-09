package v2

import (
	"github.com/sipcapture/gossipper/internal/sipcapture"
	"github.com/sipcapture/gossipper/internal/supervisor"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
)

func TestCaptureAPIStoredMessagesAndDisabledJobs(t *testing.T) {
	h := newHarness(t, false)
	dir := filepath.Join(h.store.Layout().Root, "artifacts", "jobs", "trace")
	if err := supervisor.SaveCaptureConfig(dir, supervisor.CaptureConfig{Enabled: true}); err != nil {
		t.Fatal(err)
	}
	_, err := h.reg.Store.Create(t.Context(), supervisor.Job{ID: "trace", Status: supervisor.StatusSucceeded, ArtifactsDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	cap, err := sipcapture.OpenWithMode(filepath.Join(dir, "sip-capture"), false)
	if err != nil {
		t.Fatal(err)
	}
	cap.Register("call-10001", 10001)
	cap.Record("send", "127.0.0.1:5060", "127.0.0.1:5080", []byte("INVITE sip:test SIP/2.0\r\nCall-ID: call-10001\r\n\r\n"))
	if err = cap.Close(); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"sip-capture", "sip-calls", "sip-messages?call_id=call-10001", "sip-export?call_id=call-10001"} {
		resp := h.do(http.MethodGet, "/api/v2/jobs/trace/"+path, nil)
		b, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatalf("%s: %d %s", path, resp.StatusCode, b)
		}
		if strings.Contains(path, "messages") && !strings.Contains(string(b), "call-10001") {
			t.Fatalf("missing message: %s", b)
		}
	}
	resp := h.do(http.MethodGet, "/api/v2/jobs/trace/sip-export?call_id=", nil)
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if len(b) != 0 {
		t.Fatalf("unassociated export leaked other calls: %s", b)
	}
	resp = h.do(http.MethodGet, "/api/v2/jobs/does-not-exist/sip-messages", nil)
	resp.Body.Close()
	if resp.StatusCode != 404 {
		t.Fatal(resp.StatusCode)
	}
}
