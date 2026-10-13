package uistore

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/sipcapture/gossipper/internal/dbstore"
)

// This test intentionally resets its table; only the disposable named DB is accepted.
func TestMySQLUIObjectsMigrationAndLifecycle(t *testing.T) {
	dsn := os.Getenv("GOSSIPPER_TEST_UI_MYSQL_DSN")
	if dsn == "" {
		t.Skip("requires disposable gossipper_ui_test database")
	}
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil || cfg.DBName != "gossipper_ui_test" {
		t.Fatal("use only disposable gossipper_ui_test database")
	}
	t.Setenv("GOSSIPPER_MYSQL_DSN", "")
	root := t.TempDir()
	local, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	_, err = local.PutClientProfile(ClientProfile{ID: "client", Name: "old-file", ScenarioRef: "scene", RemoteIP: "127.0.0.1"}, true)
	if err != nil {
		t.Fatal(err)
	}
	_, err = local.PutServerProfile(ServerProfile{ID: "server", ScenarioRef: "scene"}, true)
	if err != nil {
		t.Fatal(err)
	}
	_, err = local.PutScenario(ScenarioMeta{ID: "scene", Role: "client"}, "<scenario name=\"old\"/>", true)
	if err != nil {
		t.Fatal(err)
	}
	_, err = local.PutScenario(ScenarioMeta{ID: "scene", Role: "client"}, "<scenario name=\"current\"/>", false)
	if err != nil {
		t.Fatal(err)
	}
	before, err := local.ListScenarioHistory("scene")
	if err != nil || len(before) != 1 {
		t.Fatal(before, err)
	}
	file := filepath.Join(local.layout.ClientsDir(), "client.json")
	original, _ := os.ReadFile(file)
	t.Setenv("GOSSIPPER_MYSQL_DSN", dsn)
	db, err := dbstore.Open()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("DROP TABLE IF EXISTS gossipper_ui_objects"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		defer db.Close()
		if _, err := db.Exec("DROP TABLE IF EXISTS gossipper_ui_objects"); err != nil {
			t.Error(err)
		}
	})
	// An invalid input must not commit even the import-complete marker.
	if err = os.WriteFile(file, []byte("invalid"), 0600); err != nil {
		t.Fatal(err)
	}
	if s, e := Open(root); e == nil {
		s.Close()
		t.Fatal("corrupt file unexpectedly imported")
	}
	var count int
	if err = db.QueryRow("SELECT COUNT(*) FROM gossipper_ui_objects").Scan(&count); err != nil || count != 0 {
		t.Fatal("partial import", count, err)
	}
	if err = os.WriteFile(file, original, 0600); err != nil {
		t.Fatal(err)
	}
	// Existing DB objects must win over same-ID files.
	p := ClientProfile{ID: "client", Name: "database-wins"}
	raw, _ := json.Marshal(p)
	if _, err = db.Exec("INSERT INTO gossipper_ui_objects(kind,id,revision,payload) VALUES('client','client','',?)", raw); err != nil {
		t.Fatal(err)
	}
	s, err := OpenWithOptions(root, StoreOptions{ScenarioHistoryKeep: 2})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	p, err = s.GetClientProfile("client")
	if err != nil || p.Name != "database-wins" {
		t.Fatal(p, err)
	}
	if _, err = s.GetServerProfile("server"); err != nil {
		t.Fatal(err)
	}
	h, err := s.ListScenarioHistory("scene")
	if err != nil || len(h) != 1 || h[0].TS != before[0].TS {
		t.Fatal(h, err)
	}
	fixed := time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return fixed }
	for _, xml := range []string{"<scenario name=\"new1\"/>", "<scenario name=\"new2\"/>", "<scenario name=\"new3\"/>"} {
		if _, err = s.PutScenario(ScenarioMeta{ID: "scene", Role: "server"}, xml, false); err != nil {
			t.Fatal(err)
		}
	}
	h, err = s.ListScenarioHistory("scene")
	if err != nil || len(h) != 2 || h[0].TS == h[1].TS {
		t.Fatal(h, err)
	}
	if _, err = s.ForkScenarioFromHistory("scene", h[0].TS, ScenarioMeta{ID: "fork"}); err != nil {
		t.Fatal(err)
	}
	if err = s.DeleteScenarioHistory("scene", h[0].TS); err != nil {
		t.Fatal(err)
	}
	if _, err = s.PutScenario(ScenarioMeta{ID: "scene"}, "<scenario/>", true); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	if _, err = s.PutClientProfile(ClientProfile{ID: "client"}, true); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	// Another root with no profile/scenario files must read the same DB objects.
	other, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	b, err := other.GetScenario("scene")
	if err != nil || b.Meta.Role != "server" || b.XML != "<scenario name=\"new3\"/>" {
		t.Fatal(b, err)
	}
	if _, err = other.PutClientProfile(ClientProfile{ID: "client", Name: "updated-in-db"}, false); err != nil {
		t.Fatal(err)
	}
	p, err = s.GetClientProfile("client")
	if err != nil || p.Name != "updated-in-db" {
		t.Fatal(p, err)
	}
	after, _ := os.ReadFile(file)
	if string(after) != string(original) {
		t.Fatal("database writes modified legacy file")
	}
	if err = s.DeleteScenario("scene"); err != nil {
		t.Fatal(err)
	}
	if err = s.DeleteClientProfile("client"); err != nil {
		t.Fatal(err)
	}
	if err = s.DeleteServerProfile("server"); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if _, err = reopened.GetClientProfile("client"); !errors.Is(err, ErrNotFound) {
		t.Fatal("resurrected client", err)
	}
	if _, err = reopened.GetScenario("scene"); !errors.Is(err, ErrNotFound) {
		t.Fatal("resurrected scenario", err)
	}
	if _, err = reopened.GetScenarioHistory("scene", h[1].TS); !errors.Is(err, ErrNotFound) {
		t.Fatal("orphan history", err)
	}
	if _, err = reopened.GetClientProfile("../bad"); !errors.Is(err, ErrInvalidID) {
		t.Fatal(err)
	}
	// A stopped/unavailable DB must not silently serve retained filesystem data.
	reopened.Close()
	if _, err = reopened.GetClientProfile("client"); err == nil || errors.Is(err, ErrNotFound) {
		t.Fatal("DB failure fell back to filesystem", err)
	}
}
