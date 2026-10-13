package sipcapture

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/sipcapture/gossipper/internal/dbstore"
)

func TestMySQLCaptureIsolationRecoveryAndDelete(t *testing.T) {
	dsn := os.Getenv("GOSSIPPER_TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("set GOSSIPPER_TEST_MYSQL_DSN for integration test")
	}
	t.Setenv("GOSSIPPER_MYSQL_DSN", dsn)
	db, err := dbstore.Open()
	if err != nil {
		t.Fatal(err)
	}
	if err = dbstore.Migrate(db); err != nil {
		t.Fatal(err)
	}
	db.Close()
	root := t.TempDir()
	a := filepath.Join(root, fmt.Sprintf("mysql-test-a-%d", time.Now().UnixNano()), "sip-capture")
	b := filepath.Join(root, fmt.Sprintf("mysql-test-b-%d", time.Now().UnixNano()), "sip-capture")
	t.Cleanup(func() { _ = Delete(a); _ = Delete(b) })
	record := func(w *Writer, id string) {
		w.Record("out", "127.0.0.1:1", "127.0.0.1:2", []byte("INVITE sip:test SIP/2.0\r\nCall-ID: "+id+"\r\n\r\n"))
	}
	for _, dir := range []string{a, b} {
		w, e := OpenWithMode(dir, false)
		if e != nil {
			t.Fatal(e)
		}
		w.Register("same-call", 1)
		record(w, "same-call")
		w.Register("later-call", 10001)
		record(w, "later-call")
		if e = w.Close(); e != nil {
			t.Fatal(e)
		}
	}
	w, err := OpenWithMode(a, false)
	if err != nil {
		t.Fatal(err)
	}
	record(w, "same-call")
	if err = w.Close(); err != nil {
		t.Fatal(err)
	}
	calls, more, err := ListCalls(a, 0, 1)
	if err != nil || !more || len(calls) != 1 || calls[0].Messages != 2 || calls[0].Shard != 0 {
		t.Fatalf("calls=%+v more=%v err=%v", calls, more, err)
	}
	calls, more, err = ListCalls(a, 1, 1)
	if err != nil || more || len(calls) != 1 || calls[0].CallSeq != 10001 {
		t.Fatalf("page=%+v %v %v", calls, more, err)
	}
	messages, more, err := ReadMessages(a, "same-call", 0, 1)
	if err != nil || !more || len(messages) != 1 {
		t.Fatalf("messages=%+v %v %v", messages, more, err)
	}
	messages, more, err = ReadMessages(a, "same-call", messages[0].Seq, 1)
	if err != nil || more || len(messages) != 1 || messages[0].CallSeq != 1 {
		t.Fatalf("page=%+v %v %v", messages, more, err)
	}
	files, _ := filepath.Glob(filepath.Join(a, "*.sqlite"))
	if len(files) != 0 {
		t.Fatal("MySQL capture created SQLite shards")
	}
	if err = Delete(a); err != nil {
		t.Fatal(err)
	}
	calls, _, err = ListCalls(a, 0, 10)
	if err != nil || len(calls) != 0 {
		t.Fatal("deleted capture remains")
	}
	calls, _, err = ListCalls(b, 0, 10)
	if err != nil || len(calls) != 2 {
		t.Fatal("deleting one job affected another")
	}
}
