// Package dbstore contains the optional MySQL backend and its SQL dialect.
package dbstore

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

func Enabled() bool           { return strings.TrimSpace(os.Getenv("GOSSIPPER_MYSQL_DSN")) != "" }
func IsMySQL(db *sql.DB) bool { _, ok := db.Driver().(*mysql.MySQLDriver); return ok }

func Open() (*sql.DB, error) {
	cfg, err := mysql.ParseDSN(os.Getenv("GOSSIPPER_MYSQL_DSN"))
	if err != nil {
		return nil, errors.New("invalid GOSSIPPER_MYSQL_DSN")
	}
	if cfg.DBName == "" {
		return nil, errors.New("MySQL database name is required")
	}
	cfg.Timeout = 5 * time.Second
	cfg.ReadTimeout = 15 * time.Second
	cfg.WriteTimeout = 15 * time.Second
	cfg.ClientFoundRows = true // unchanged updates still report an existing row
	cfg.ParseTime = false
	cfg.Collation = "utf8mb4_bin"
	if cfg.Params == nil {
		cfg.Params = map[string]string{}
	}
	cfg.Params["charset"] = "utf8mb4"
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err = db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

var tableNames = regexp.MustCompile(`\b(users|jobs|job_artifacts|audit_log|kv_settings)\b`)
var keyName = regexp.MustCompile(`\bkey\b`)

// SQL adapts only the application's fixed settings/job SQL. Never use it for user SQL.
// Parameters are passed separately to database/sql and are never rewritten.
func SQL(db *sql.DB, q string) string {
	if !IsMySQL(db) {
		return q
	}
	q = tableNames.ReplaceAllString(q, "gossipper_$1")
	q = keyName.ReplaceAllString(q, "`key`")
	q = strings.ReplaceAll(q, "ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash", "ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)")
	q = strings.ReplaceAll(q, "ON CONFLICT(`key`) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", "ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)")
	return q
}
