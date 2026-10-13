package dbstore

import (
	"database/sql"
	"strings"
	"testing"
)

func TestDialect(t *testing.T) {
	mysqlDB, err := sql.Open("mysql", "test@tcp(localhost:3306)/test")
	if err != nil {
		t.Fatal(err)
	}
	defer mysqlDB.Close()
	sqliteDB, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer sqliteDB.Close()
	for _, tc := range []struct{ sql, want string }{
		{"SELECT value FROM kv_settings WHERE key = ?", "SELECT value FROM gossipper_kv_settings WHERE `key` = ?"},
		{"SELECT j.id FROM jobs j JOIN job_artifacts a ON j.id=a.job_id", "SELECT j.id FROM gossipper_jobs j JOIN gossipper_job_artifacts a ON j.id=a.job_id"},
		{"INSERT INTO users(username,password_hash,created_at) VALUES(?,?,?) ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash", "INSERT INTO gossipper_users(username,password_hash,created_at) VALUES(?,?,?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)"},
		{"INSERT INTO kv_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", "INSERT INTO gossipper_kv_settings(`key`,value,updated_at) VALUES(?,?,?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)"},
	} {
		if got := SQL(mysqlDB, tc.sql); got != tc.want {
			t.Fatalf("%s != %s", got, tc.want)
		}
		if got := SQL(sqliteDB, tc.sql); got != tc.sql {
			t.Fatal("SQLite SQL changed")
		}
	}
}
func TestInvalidDSNDoesNotExposeSecret(t *testing.T) {
	t.Setenv("GOSSIPPER_MYSQL_DSN", "test:secret@broken")
	_, err := Open()
	if err == nil || strings.Contains(err.Error(), "secret") {
		t.Fatalf("unexpected error: %v", err)
	}
}
