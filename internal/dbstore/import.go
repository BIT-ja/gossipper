package dbstore

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// ImportSQLite copies an offline data directory into empty MySQL tables.
// Source files are never modified; all row imports commit in one transaction.
func ImportSQLite(ctx context.Context, dir string) (map[string]int64, error) {
	if !Enabled() {
		return nil, fmt.Errorf("GOSSIPPER_MYSQL_DSN is required")
	}
	src, err := sqliteRead(filepath.Join(dir, "settings.sqlite"))
	if err != nil {
		return nil, err
	}
	defer src.Close()
	var running int
	if err = src.QueryRowContext(ctx, `SELECT COUNT(*) FROM jobs WHERE status IN ('running','pending')`).Scan(&running); err != nil {
		return nil, err
	}
	if running != 0 {
		return nil, fmt.Errorf("source has %d unfinished jobs; stop them before migration", running)
	}
	db, err := Open()
	if err != nil {
		return nil, err
	}
	defer db.Close()
	if err = Migrate(db); err != nil {
		return nil, err
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	var locked int
	if err = conn.QueryRowContext(ctx, `SELECT GET_LOCK('gossipper_mysql_import',0)`).Scan(&locked); err != nil {
		return nil, err
	}
	if locked != 1 {
		return nil, fmt.Errorf("another migration is active")
	}
	defer conn.ExecContext(context.Background(), `SELECT RELEASE_LOCK('gossipper_mysql_import')`)
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	names := append(append([]string{}, Tables...), "sip_calls", "sip_messages")
	for _, name := range names {
		var n int64
		if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM gossipper_"+name).Scan(&n); err != nil {
			return nil, err
		}
		if n > 0 {
			return nil, fmt.Errorf("target gossipper_%s is not empty; refusing overwrite", name)
		}
	}
	counts := map[string]int64{}
	for _, name := range Tables {
		rows, e := src.QueryContext(ctx, "SELECT * FROM "+name)
		if e != nil {
			return nil, e
		}
		columns, e := rows.Columns()
		if e != nil {
			rows.Close()
			return nil, e
		}
		quoted := make([]string, len(columns))
		for i, c := range columns {
			quoted[i] = "`" + c + "`"
		}
		query := "INSERT INTO gossipper_" + name + " (" + strings.Join(quoted, ",") + ") VALUES (" + strings.TrimSuffix(strings.Repeat("?,", len(columns)), ",") + ")"
		for rows.Next() {
			values := make([]any, len(columns))
			ptrs := make([]any, len(columns))
			for i := range values {
				ptrs[i] = &values[i]
			}
			if e = rows.Scan(ptrs...); e != nil {
				break
			}
			if _, e = tx.ExecContext(ctx, query, values...); e != nil {
				break
			}
			counts[name]++
		}
		if e == nil {
			e = rows.Err()
		}
		rows.Close()
		if e != nil {
			return nil, e
		}
	}
	dirs, err := filepath.Glob(filepath.Join(dir, "artifacts", "jobs", "*", "sip-capture"))
	if err != nil {
		return nil, err
	}
	for _, capture := range dirs {
		job := filepath.Base(filepath.Dir(capture))
		paths, e := filepath.Glob(filepath.Join(capture, "shard-*.sqlite"))
		if e != nil {
			return nil, e
		}
		for _, path := range paths {
			source, e := sqliteRead(path)
			if e != nil {
				return nil, e
			}
			rows, e := source.QueryContext(ctx, `SELECT seq,call_seq,call_id,time,direction,src,dst,raw,summary FROM messages ORDER BY seq`)
			if e != nil {
				source.Close()
				return nil, e
			}
			for rows.Next() {
				values := make([]any, 9)
				ptrs := make([]any, 9)
				for i := range values {
					ptrs[i] = &values[i]
				}
				if e = rows.Scan(ptrs...); e != nil {
					break
				}
				args := append([]any{job}, values...)
				if _, e = tx.ExecContext(ctx, `INSERT INTO gossipper_sip_messages(job_id,seq,call_seq,call_id,time,direction,src,dst,raw,summary) VALUES(?,?,?,?,?,?,?,?,?,?)`, args...); e != nil {
					break
				}
				counts["sip_messages"]++
			}
			if e == nil {
				e = rows.Err()
			}
			rows.Close()
			source.Close()
			if e != nil {
				return nil, e
			}
		}
		// Derive counters from committed source messages, including interrupted captures.
		res, e := tx.ExecContext(ctx, `INSERT INTO gossipper_sip_calls(job_id,call_hash,call_id,call_seq,messages)
 SELECT job_id,UNHEX(SHA2(call_id,256)),call_id,call_seq,COUNT(*) FROM gossipper_sip_messages
 WHERE job_id=? AND call_seq>0 GROUP BY job_id,call_id,call_seq`, job)
		if e != nil {
			return nil, e
		}
		n, e := res.RowsAffected()
		if e != nil {
			return nil, e
		}
		counts["sip_calls"] += n

	}
	for _, name := range names {
		var n int64
		if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM gossipper_"+name).Scan(&n); err != nil {
			return nil, err
		}
		if n != counts[name] {
			return nil, fmt.Errorf("row count mismatch for %s: %d != %d", name, n, counts[name])
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return counts, nil
}

func sqliteRead(path string) (*sql.DB, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", "file:"+filepath.ToSlash(path)+"?mode=ro")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetConnMaxLifetime(time.Minute)
	return db, nil
}
