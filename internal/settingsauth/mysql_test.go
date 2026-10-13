package settingsauth

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestMySQLAuthAndSettings(t *testing.T) {
	dsn := os.Getenv("GOSSIPPER_TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("set GOSSIPPER_TEST_MYSQL_DSN for integration test")
	}
	t.Setenv("GOSSIPPER_MYSQL_DSN", dsn)
	db, err := OpenStore(filepath.Join(t.TempDir(), "unused.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	name := fmt.Sprintf("mysql-test-%d", time.Now().UnixNano())
	defer db.ExecContext(ctx, "DELETE FROM gossipper_users WHERE username=?", name)
	defer db.ExecContext(ctx, "DELETE FROM gossipper_kv_settings WHERE `key`=?", name)
	if err = CreateUser(ctx, db, name, "test-password-a"); err != nil {
		t.Fatal(err)
	}
	id, err := VerifyUser(ctx, db, name, "test-password-a")
	if err != nil {
		t.Fatal(err)
	}
	if err = CreateUser(ctx, db, name, "test-password-b"); err != nil {
		t.Fatal(err)
	}
	id2, err := VerifyUser(ctx, db, name, "test-password-b")
	if err != nil || id2 != id {
		t.Fatalf("upsert changed id or failed: %d %d %v", id, id2, err)
	}
	for i := 0; i < 2; i++ {
		if err = UpdateUserRole(ctx, db, id, "operator"); err != nil {
			t.Fatal(err)
		}
	}
	for _, value := range []string{"one", "two"} {
		if err = PutSetting(ctx, db, name, value); err != nil {
			t.Fatal(err)
		}
	}
	if value, err := GetSetting(ctx, db, name); err != nil || value != "two" {
		t.Fatalf("setting=%s err=%v", value, err)
	}
	if err = DeleteUser(ctx, db, id); err != nil {
		t.Fatal(err)
	}
}
