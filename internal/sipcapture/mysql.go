package sipcapture

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/sipcapture/gossipper/internal/dbstore"
	"github.com/sipcapture/gossipper/internal/timefmt"
)

func captureJobID(dir string) string { return filepath.Base(filepath.Dir(filepath.Clean(dir))) }

func openMySQL(dir string, external bool) (*Writer, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	db, err := dbstore.Open()
	if err != nil {
		return nil, err
	}
	w := &Writer{dir: dir, external: external, calls: map[string]int64{}, state: "recording", queue: make(chan Message, 4096), done: make(chan struct{}), catalog: db, mysqlJob: captureJobID(dir)}
	err = db.QueryRow(`SELECT COALESCE(MAX(seq),0),COUNT(*),COALESCE(MAX(call_seq),0) FROM gossipper_sip_messages WHERE job_id=?`, w.mysqlJob).Scan(&w.nextMessage, &w.messages, &w.nextCall)
	if err != nil {
		db.Close()
		return nil, err
	}
	if external {
		rows, e := db.Query(`SELECT call_id,call_seq FROM gossipper_sip_calls WHERE job_id=?`, w.mysqlJob)
		if e != nil {
			db.Close()
			return nil, e
		}
		for rows.Next() {
			var id string
			var seq int64
			if e = rows.Scan(&id, &seq); e != nil {
				break
			}
			w.calls[id] = seq
		}
		if e == nil {
			e = rows.Err()
		}
		rows.Close()
		if e != nil {
			db.Close()
			return nil, e
		}
	}
	if s, e := Status(dir); e == nil {
		if n, ok := s["dropped"].(float64); ok {
			w.dropped = int64(n)
		}
	}
	if err = w.saveStatus(); err != nil {
		db.Close()
		return nil, err
	}
	go w.run()
	return w, nil
}

func (w *Writer) writeMySQL(batch []Message) error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	tx, err := w.catalog.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	type callCount struct {
		id         string
		seq, count int64
	}
	calls := map[string]*callCount{}
	resolved := map[string]int64{}
	args := make([]any, 0, len(batch)*10)
	for i := range batch {
		m := &batch[i]
		if !w.external && m.CallSeq == 0 && m.CallID != "" {
			seq, ok := resolved[m.CallID]
			if !ok {
				hash := sha256.Sum256([]byte(m.CallID))
				e := tx.QueryRowContext(ctx, `SELECT call_seq FROM gossipper_sip_calls WHERE job_id=? AND call_hash=?`, w.mysqlJob, hash[:]).Scan(&seq)
				if e != nil && !errors.Is(e, sql.ErrNoRows) {
					return e
				}
				resolved[m.CallID] = seq
			}
			m.CallSeq = seq
		}
		if m.CallSeq > 0 {
			resolved[m.CallID] = m.CallSeq
		}
		args = append(args, w.mysqlJob, m.Seq, m.CallSeq, m.CallID, m.Time, m.Direction, m.Src, m.Dst, m.Raw, m.Summary)
		if m.CallID != "" && m.CallSeq > 0 {
			c := calls[m.CallID]
			if c == nil {
				c = &callCount{id: m.CallID, seq: m.CallSeq}
				calls[m.CallID] = c
			}
			c.count++
		}
	}
	if len(batch) == 0 {
		return nil
	}
	query := `INSERT INTO gossipper_sip_messages(job_id,seq,call_seq,call_id,time,direction,src,dst,raw,summary) VALUES ` + strings.TrimSuffix(strings.Repeat("(?,?,?,?,?,?,?,?,?,?),", len(batch)), ",")
	if _, err = tx.ExecContext(ctx, query, args...); err != nil {
		return err
	}
	if len(calls) > 0 {
		args = args[:0]
		for _, c := range calls {
			h := sha256.Sum256([]byte(c.id))
			args = append(args, w.mysqlJob, h[:], c.id, c.seq, c.count)
		}
		query = `INSERT INTO gossipper_sip_calls(job_id,call_hash,call_id,call_seq,messages) VALUES ` + strings.TrimSuffix(strings.Repeat("(?,?,?,?,?),", len(calls)), ",") + ` ON DUPLICATE KEY UPDATE messages=messages+VALUES(messages)`
		if _, err = tx.ExecContext(ctx, query, args...); err != nil {
			return err
		}
	}

	if err = tx.Commit(); err != nil {
		return err
	}
	if !w.external {
		w.mu.Lock()
		for _, m := range batch {
			if m.CallSeq > 0 && w.calls[m.CallID] == m.CallSeq {
				delete(w.calls, m.CallID)
			}
		}
		w.mu.Unlock()
	}
	return nil
}

func listMySQLCalls(dir string, after int64, limit int) ([]Call, bool, error) {
	db, err := dbstore.Open()
	if err != nil {
		return nil, false, err
	}
	defer db.Close()
	limit = capLimit(limit)
	rows, err := db.Query(`SELECT call_id,call_seq,messages FROM gossipper_sip_calls WHERE job_id=? AND call_seq>? ORDER BY call_seq LIMIT ?`, captureJobID(dir), after, limit+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	out := []Call{}
	for rows.Next() {
		var c Call
		if err = rows.Scan(&c.CallID, &c.CallSeq, &c.Messages); err != nil {
			return nil, false, err
		}
		out = append(out, c)
	}
	more := len(out) > limit
	if more {
		out = out[:limit]
	}
	return out, more, rows.Err()
}

func readMySQLMessages(dir, id string, after int64, limit int) ([]Message, bool, error) {
	db, err := dbstore.Open()
	if err != nil {
		return nil, false, err
	}
	defer db.Close()
	job := captureJobID(dir)
	var seq int64
	if id != "" {
		hash := sha256.Sum256([]byte(id))
		err = db.QueryRow(`SELECT call_seq FROM gossipper_sip_calls WHERE job_id=? AND call_hash=?`, job, hash[:]).Scan(&seq)
		if errors.Is(err, sql.ErrNoRows) {
			return []Message{}, false, nil
		}
		if err != nil {
			return nil, false, err
		}
	}
	limit = capLimit(limit)
	rows, err := db.Query(`SELECT seq,call_seq,call_id,time,direction,src,dst,raw,summary FROM gossipper_sip_messages WHERE job_id=? AND call_seq=? AND seq>? ORDER BY seq LIMIT ?`, job, seq, after, limit+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	out := []Message{}
	for rows.Next() {
		var m Message
		if err = rows.Scan(&m.Seq, &m.CallSeq, &m.CallID, &m.Time, &m.Direction, &m.Src, &m.Dst, &m.Raw, &m.Summary); err != nil {
			return nil, false, err
		}
		m.Time = timefmt.Capture(m.Time)
		out = append(out, m)
	}
	more := len(out) > limit
	if more {
		out = out[:limit]
	}
	return out, more, rows.Err()
}

// Delete removes a single job's capture, including MySQL rows when enabled.
func Delete(dir string) error {
	if dbstore.Enabled() {
		db, err := dbstore.Open()
		if err != nil {
			return err
		}
		defer db.Close()
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		job := captureJobID(dir)
		if _, err = tx.Exec(`DELETE FROM gossipper_sip_messages WHERE job_id=?`, job); err != nil {
			return err
		}
		if _, err = tx.Exec(`DELETE FROM gossipper_sip_calls WHERE job_id=?`, job); err != nil {
			return err
		}
		if err = tx.Commit(); err != nil {
			return err
		}
	}
	return os.RemoveAll(dir)
}
