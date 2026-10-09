package sipcapture

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCallShardsAndRetransmission(t *testing.T) {
	dir := t.TempDir()
	w, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	w.Register("a-10000", 10000)
	w.Register("b-10001", 10001)
	a := []byte("INVITE sip:x SIP/2.0\r\nCall-ID: a-10000\r\n\r\n")
	w.Record("send", "a", "b", a)
	w.Record("send", "a", "b", a)
	w.Record("recv", "b", "a", []byte("SIP/2.0 200 OK\r\nCall-ID: b-10001\r\n\r\n"))
	w.Record("recv", "b", "a", []byte("invalid"))
	if err = w.Close(); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"shard-000000.sqlite", "shard-000001.sqlite", "shard-000002.sqlite"} {
		if _, err = os.Stat(filepath.Join(dir, f)); err != nil {
			t.Fatal(err)
		}
	}
	msgs, more, err := ReadMessages(dir, "a-10000", 0, 1)
	if err != nil || !more || len(msgs) != 1 || msgs[0].CallSeq != 10000 {
		t.Fatalf("%+v %v %v", msgs, more, err)
	}
	next, more, err := ReadMessages(dir, "a-10000", msgs[0].Seq, 10)
	if err != nil || more || len(next) != 1 || next[0].Raw != msgs[0].Raw {
		t.Fatalf("%+v %v %v", next, more, err)
	}
	calls, _, err := ListCalls(dir, 0, 10)
	if err != nil || len(calls) != 2 || calls[0].Messages != 2 || calls[1].Shard != 2 {
		t.Fatalf("%+v %v", calls, err)
	}
	unknown, _, err := ReadMessages(dir, "", 0, 10)
	if err != nil || len(unknown) != 1 || unknown[0].CallSeq != 0 {
		t.Fatalf("%+v %v", unknown, err)
	}
	s, err := Status(dir)
	if err != nil || s["messages"] != float64(4) || s["status"] != "complete" {
		t.Fatalf("%+v %v", s, err)
	}
}
func TestRedactionAndAutomaticCallSequence(t *testing.T) {
	dir := t.TempDir()
	w, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	raw := "INVITE sip:x SIP/2.0\r\nCall-ID: incoming\r\nAuthorization: Digest secret\r\n foldedsecret\r\nProxy-Authorization: anothersecret\r\n\r\na=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:keysecret\r\nk=clear:keysecret\r\na=rtpmap:0 PCMU/8000\r\n"
	w.Record("recv", "a", "b", []byte(raw))
	if err = w.Close(); err != nil {
		t.Fatal(err)
	}
	msgs, _, err := ReadMessages(dir, "incoming", 0, 10)
	if err != nil || len(msgs) != 1 {
		t.Fatal(err)
	}
	if strings.Contains(msgs[0].Raw, "secret") || !strings.Contains(msgs[0].Raw, "a=rtpmap:0 PCMU/8000") || msgs[0].CallSeq != 1 {
		t.Fatal(msgs[0])
	}
}
func TestUACUnknownAndRecovery(t *testing.T) {
	dir := t.TempDir()
	w, err := OpenWithMode(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	w.Record("recv", "a", "b", []byte("SIP/2.0 200 OK\r\nCall-ID: unknown\r\n\r\n"))
	w.Register("own-0001", 1)
	w.Record("send", "b", "a", []byte("INVITE sip:x SIP/2.0\r\nCall-ID: own-0001\r\n\r\n"))
	if err = w.Close(); err != nil {
		t.Fatal(err)
	}
	// Simulate stale metadata and a catalog not committed before process loss.
	if err = os.WriteFile(filepath.Join(dir, "status.json"), []byte(`{"sequence":0}`), 0600); err != nil {
		t.Fatal(err)
	}
	db, err := openDB(filepath.Join(dir, "catalog.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`DELETE FROM calls`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	w, err = OpenWithMode(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	w.Record("send", "b", "a", []byte("BYE sip:x SIP/2.0\r\nCall-ID: own-0001\r\n\r\n"))
	if err = w.Close(); err != nil {
		t.Fatal(err)
	}
	messages, _, err := ReadMessages(dir, "own-0001", 0, 10)
	if err != nil || len(messages) != 2 || messages[1].Seq != 3 {
		t.Fatalf("%+v %v", messages, err)
	}
	unknown, _, err := ReadMessages(dir, "", 0, 10)
	if err != nil || len(unknown) != 1 || unknown[0].CallSeq != 0 {
		t.Fatalf("%+v %v", unknown, err)
	}
	s, err := Status(dir)
	if err != nil || s["messages"] != float64(3) {
		t.Fatalf("%+v %v", s, err)
	}
}

func TestMemoryBudget(t *testing.T) {
	w := &Writer{calls: map[string]int64{}, queue: make(chan Message, 10)}
	w.Record("recv", "a", "b", []byte(strings.Repeat("x", int(maxQueuedBytes))))
	if w.dropped != 1 || w.queuedBytes != 0 || len(w.queue) != 0 {
		t.Fatalf("budget not enforced: %d %d", w.dropped, w.queuedBytes)
	}
	w.Record("recv", "a", "b", []byte("SIP/2.0 200 OK\r\n\r\n"))
	if len(w.queue) != 1 || w.queuedBytes == 0 {
		t.Fatal("small message was rejected")
	}
}
func TestEvictedRegistrationUsesExactCatalog(t *testing.T) {
	dir := t.TempDir()
	w, err := OpenWithMode(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	w.Register("own-10001", 10001)
	w.Record("send", "a", "b", []byte("INVITE sip:x SIP/2.0\r\nCall-ID: own-10001\r\n\r\n"))
	deadline := time.Now().Add(3 * time.Second)
	for {
		w.mu.Lock()
		_, present := w.calls["own-10001"]
		w.mu.Unlock()
		if !present {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("persisted registration not evicted")
		}
		time.Sleep(10 * time.Millisecond)
	}
	w.Record("recv", "b", "a", []byte("SIP/2.0 200 OK\r\nCall-ID: own-10001\r\n\r\n"))
	w.Record("recv", "b", "a", []byte("SIP/2.0 200 OK\r\nCall-ID: forged-10001\r\n\r\n"))
	if err = w.Close(); err != nil {
		t.Fatal(err)
	}
	msgs, _, err := ReadMessages(dir, "own-10001", 0, 10)
	if err != nil || len(msgs) != 2 || msgs[1].CallSeq != 10001 {
		t.Fatalf("%+v %v", msgs, err)
	}
	unknown, _, err := ReadMessages(dir, "", 0, 10)
	if err != nil || len(unknown) != 1 || unknown[0].CallID != "forged-10001" {
		t.Fatalf("%+v %v", unknown, err)
	}
	if w.queuedBytes != 0 {
		t.Fatal("queued bytes not released")
	}
}
func TestStatusWriteFailureReturnedByClose(t *testing.T) {
	dir := t.TempDir()
	w, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(filepath.Join(dir, "status.json.tmp"), 0700); err != nil {
		t.Fatal(err)
	}
	if err = w.Close(); err == nil || !strings.Contains(err.Error(), "save capture status") {
		t.Fatalf("missing status failure: %v", err)
	}
}
