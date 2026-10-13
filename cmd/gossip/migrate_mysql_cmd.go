package main

import (
	"context"
	"encoding/json"
	"flag"
	"github.com/sipcapture/gossipper/internal/dbstore"
	"os"
	"time"
)

func runMigrateMySQL(args []string) error {
	fs := flag.NewFlagSet("migrate-mysql", flag.ContinueOnError)
	dir := fs.String("data-dir", "./data", "offline SQLite data directory; target from GOSSIPPER_MYSQL_DSN")
	if err := fs.Parse(args); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	counts, err := dbstore.ImportSQLite(ctx, *dir)
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(counts)
}
