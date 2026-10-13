// Package sipcapture persists SIP observations in task-local, call-count shards.
package sipcapture

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/sipcapture/gossipper/internal/dbstore"
	"github.com/sipcapture/gossipper/internal/timefmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

type Message struct {
	Seq       int64  `json:"seq"`
	CallSeq   int64  `json:"call_seq"`
	CallID    string `json:"call_id"`
	Time      string `json:"time"`
	Direction string `json:"direction"`
	Src       string `json:"src"`
	Dst       string `json:"dst"`
	Raw       string `json:"raw"`
	Summary   string `json:"summary"`
}
type Call struct {
	CallID   string `json:"call_id"`
	CallSeq  int64  `json:"call_seq"`
	Shard    int64  `json:"shard"`
	Messages int64  `json:"messages"`
}

const maxQueuedBytes int64 = 16 << 20

func messageBytes(m Message) int64 {
	return int64(len(m.Raw) + len(m.CallID) + len(m.Summary) + len(m.Src) + len(m.Dst) + len(m.Direction) + len(m.Time) + 128)
}

type Writer struct {
	mysqlJob              string
	mu                    sync.Mutex
	dir                   string
	calls                 map[string]int64
	nextCall, nextMessage int64
	dropped, messages     int64
	state, failure        string
	queue                 chan Message
	queuedBytes           int64
	done                  chan struct{}
	closed                bool
	external              bool
	catalog               *sql.DB
}

func shardFor(n int64) int64 {
	if n < 1 {
		return 0
	}
	return (n-1)/10000 + 1
}
func shardPath(dir string, n int64) string {
	return filepath.Join(dir, fmt.Sprintf("shard-%06d.sqlite", n))
}
func openDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err = db.Exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;`); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}
func Open(dir string) (*Writer, error) { return OpenWithMode(dir, true) }
func OpenWithMode(dir string, external bool) (*Writer, error) {
	if dbstore.Enabled() {
		return openMySQL(dir, external)
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	db, err := openDB(filepath.Join(dir, "catalog.sqlite"))
	if err != nil {
		return nil, err
	}
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS calls(call_id TEXT PRIMARY KEY,call_seq INTEGER NOT NULL UNIQUE,shard INTEGER NOT NULL,messages INTEGER NOT NULL DEFAULT 0); CREATE INDEX IF NOT EXISTS calls_sequence ON calls(call_seq);`)
	if err != nil {
		db.Close()
		return nil, err
	}
	w := &Writer{dir: dir, external: external, calls: map[string]int64{}, state: "recording", queue: make(chan Message, 4096), done: make(chan struct{}), catalog: db}
	if err = w.recoverShards(); err != nil {
		db.Close()
		return nil, err
	}
	query := `SELECT call_id,call_seq,messages FROM calls`
	if !external {
		query = `SELECT '',COALESCE(MAX(call_seq),0),0 FROM calls`
	}
	rows, err := db.Query(query)
	if err != nil {
		db.Close()
		return nil, err
	}
	for rows.Next() {
		var id string
		var n, count int64
		if err = rows.Scan(&id, &n, &count); err != nil {
			break
		}
		if external {
			w.calls[id] = n
		}
		if n > w.nextCall {
			w.nextCall = n
		}
	}
	rows.Close()
	if err != nil {
		db.Close()
		return nil, err
	}
	// Sequence is restored from metadata on reopening an interrupted task.
	if data, e := os.ReadFile(filepath.Join(dir, "status.json")); e == nil {
		var s struct {
			Sequence int64 `json:"sequence"`
			Dropped  int64 `json:"dropped"`
		}
		if json.Unmarshal(data, &s) == nil {
			if s.Sequence > w.nextMessage {
				w.nextMessage = s.Sequence
			}
			w.dropped = s.Dropped
		}
	}
	if err = w.saveStatus(); err != nil {
		db.Close()
		return nil, err
	}
	go w.run()
	return w, nil
}

// Register associates an outbound Call-ID with its task-wide sequence before send.
func (w *Writer) Register(id string, n int64) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if id == "" || n < 1 || w.closed {
		return
	}
	if _, ok := w.calls[id]; !ok {
		w.calls[id] = n
	}
	if n > w.nextCall {
		w.nextCall = n
	}
}
func (w *Writer) Record(direction, src, dst string, raw []byte) {
	id, summary := parse(raw)
	sanitized := redact(string(raw))
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return
	}
	var callSeq int64
	if id != "" {
		callSeq = w.calls[id]
		if callSeq == 0 && w.external {
			w.nextCall++
			callSeq = w.nextCall
			w.calls[id] = callSeq
		}
	}
	w.nextMessage++
	m := Message{Seq: w.nextMessage, CallSeq: callSeq, CallID: id, Time: time.Now().In(timefmt.Location).Format(time.RFC3339Nano), Direction: direction, Src: src, Dst: dst, Raw: sanitized, Summary: summary}
	size := messageBytes(m)
	if size > maxQueuedBytes-w.queuedBytes {
		w.dropped++
		return
	}
	select {
	case w.queue <- m:
		w.queuedBytes += size
	default:
		w.dropped++
	}
}
func parse(raw []byte) (string, string) {
	lines := strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n")
	summary := ""
	if len(lines) > 0 {
		summary = strings.TrimSpace(lines[0])
	}
	for _, l := range lines[1:] {
		if l == "" {
			break
		}
		k, v, ok := strings.Cut(l, ":")
		if ok && (strings.EqualFold(strings.TrimSpace(k), "call-id") || strings.EqualFold(strings.TrimSpace(k), "i")) {
			return strings.Clone(strings.TrimSpace(v)), strings.Clone(summary)
		}
	}
	return "", strings.Clone(summary)
}
func redact(raw string) string {
	sep := "\n"
	if strings.Contains(raw, "\r\n") {
		sep = "\r\n"
	}
	lines := strings.Split(raw, sep)
	sensitive := false
	for i, l := range lines {
		lower := strings.ToLower(strings.TrimSpace(l))
		if strings.HasPrefix(lower, "authorization:") || strings.HasPrefix(lower, "proxy-authorization:") {
			k, _, _ := strings.Cut(l, ":")
			lines[i] = k + ": [REDACTED]"
			sensitive = true
			continue
		}
		if sensitive && (strings.HasPrefix(l, " ") || strings.HasPrefix(l, "\t")) {
			lines[i] = " [REDACTED]"
			continue
		}
		sensitive = false
		if strings.HasPrefix(lower, "a=crypto:") || strings.HasPrefix(lower, "a=ice-pwd:") || strings.HasPrefix(lower, "k=") {
			k, _, _ := strings.Cut(l, ":")
			if strings.HasPrefix(lower, "k=") {
				k = "k="
				lines[i] = k + "[REDACTED]"
			} else {
				lines[i] = k + ":[REDACTED]"
			}
		}
	}
	return strings.Join(lines, sep)
}
func (w *Writer) saveStatus() error {
	w.mu.Lock()
	s := map[string]any{"enabled": true, "status": w.state, "error": w.failure, "dropped": w.dropped, "messages": w.messages, "sequence": w.nextMessage, "redacted": true}
	w.mu.Unlock()
	b, _ := json.Marshal(s)
	tmp := filepath.Join(w.dir, "status.json.tmp")
	if err := os.WriteFile(tmp, b, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(w.dir, "status.json"))
}
func (w *Writer) persistStatus() {
	if err := w.saveStatus(); err != nil {
		w.mu.Lock()
		first := w.failure == ""
		w.failure = "save capture status: " + err.Error()
		w.state = "incomplete"
		w.mu.Unlock()
		if first {
			fmt.Fprintf(os.Stderr, "sipcapture: %v\n", err)
		}
	}
}
func (w *Writer) run() {
	defer close(w.done)
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	batch := make([]Message, 0, 100)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		err := w.write(batch)
		w.mu.Lock()
		if err != nil {
			w.failure = err.Error()
			w.state = "incomplete"
			w.dropped += int64(len(batch))
		} else {
			w.messages += int64(len(batch))
		}
		for _, m := range batch {
			w.queuedBytes -= messageBytes(m)
		}
		w.mu.Unlock()
		batch = batch[:0]
		w.persistStatus()
	}
	for {
		select {
		case m, ok := <-w.queue:
			if !ok {
				flush()
				w.mu.Lock()
				if w.failure == "" {
					w.state = "complete"
				}
				if w.dropped > 0 {
					w.state = "incomplete"
				}
				w.mu.Unlock()
				w.persistStatus()
				w.catalog.Close()
				return
			}
			batch = append(batch, m)
			if len(batch) >= 100 {
				flush()
			}
		case <-ticker.C:
			flush()
			w.persistStatus()
		}
	}
}
func (w *Writer) write(batch []Message) error {
	if w.mysqlJob != "" {
		return w.writeMySQL(batch)
	}
	groups := map[int64][]Message{}
	for _, m := range batch {
		// UAC registrations are evicted only after catalog commit; late traffic resolves
		// here on the writer goroutine, never on the socket receive/send goroutine.
		if !w.external && m.CallSeq == 0 && m.CallID != "" {
			err := w.catalog.QueryRow(`SELECT call_seq FROM calls WHERE call_id=?`, m.CallID).Scan(&m.CallSeq)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
		}
		n := shardFor(m.CallSeq)
		groups[n] = append(groups[n], m)
	}
	// Open one shard at a time: late responses never grow the connection count.
	for n, msgs := range groups {
		db, err := openDB(shardPath(w.dir, n))
		if err != nil {
			return err
		}
		_, err = db.Exec(`CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY,call_seq INTEGER NOT NULL,call_id TEXT NOT NULL,time TEXT NOT NULL,direction TEXT NOT NULL,src TEXT NOT NULL,dst TEXT NOT NULL,raw TEXT NOT NULL,summary TEXT NOT NULL); CREATE INDEX IF NOT EXISTS messages_call_sequence ON messages(call_seq,seq);`)
		if err != nil {
			db.Close()
			return err
		}
		tx, err := db.Begin()
		if err != nil {
			db.Close()
			return err
		}
		for _, m := range msgs {
			_, err = tx.Exec(`INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?)`, m.Seq, m.CallSeq, m.CallID, m.Time, m.Direction, m.Src, m.Dst, m.Raw, m.Summary)
			if err != nil {
				break
			}
		}
		if err == nil {
			err = tx.Commit()
		} else {
			tx.Rollback()
		}
		db.Close()
		if err != nil {
			return err
		}
		ctx, err := w.catalog.Begin()
		if err != nil {
			return err
		}
		for _, m := range msgs {
			if m.CallID == "" || m.CallSeq == 0 {
				continue
			}
			_, err = ctx.Exec(`INSERT INTO calls(call_id,call_seq,shard,messages) VALUES(?,?,?,1) ON CONFLICT(call_id) DO UPDATE SET messages=messages+1`, m.CallID, m.CallSeq, n)
			if err != nil {
				ctx.Rollback()
				return err
			}
		}
		if err = ctx.Commit(); err != nil {
			return err
		}
		if !w.external {
			w.mu.Lock()
			for _, m := range msgs {
				if m.CallSeq > 0 && w.calls[m.CallID] == m.CallSeq {
					delete(w.calls, m.CallID)
				}
			}
			w.mu.Unlock()
		}
	}
	return nil
}
func (w *Writer) Close() error {
	w.mu.Lock()
	if !w.closed {
		w.closed = true
		close(w.queue)
	}
	w.mu.Unlock()
	<-w.done
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.failure != "" {
		return errors.New(w.failure)
	}
	return nil
}
func Status(dir string) (map[string]any, error) {
	b, err := os.ReadFile(filepath.Join(dir, "status.json"))
	if os.IsNotExist(err) {
		return map[string]any{"enabled": false, "status": "disabled", "messages": 0, "dropped": 0}, nil
	}
	if err != nil {
		return nil, err
	}
	var s map[string]any
	err = json.Unmarshal(b, &s)
	if dbstore.Enabled() {
		s["storage"] = "mysql"
	} else {
		s["storage"] = "sqlite"
	}
	return s, err
}
func readDB(path string) (*sql.DB, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", "file:"+filepath.ToSlash(path)+"?mode=ro")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return db, nil
}
func capLimit(n int) int {
	if n <= 0 {
		return 200
	}
	if n > 1000 {
		return 1000
	}
	return n
}
func ListCalls(dir string, after int64, limit int) ([]Call, bool, error) {
	if dbstore.Enabled() {
		return listMySQLCalls(dir, after, limit)
	}
	limit = capLimit(limit)
	out := []Call{}
	db, err := readDB(filepath.Join(dir, "catalog.sqlite"))
	if os.IsNotExist(err) {
		return out, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	defer db.Close()
	rows, err := db.Query(`SELECT call_id,call_seq,shard,messages FROM calls WHERE call_seq>? ORDER BY call_seq LIMIT ?`, after, limit+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	for rows.Next() {
		var c Call
		if err = rows.Scan(&c.CallID, &c.CallSeq, &c.Shard, &c.Messages); err != nil {
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
func ReadMessages(dir, callID string, after int64, limit int) ([]Message, bool, error) {
	if dbstore.Enabled() {
		return readMySQLMessages(dir, callID, after, limit)
	}
	limit = capLimit(limit)
	out := []Message{}
	var n, callSeq int64
	if callID != "" {
		db, err := readDB(filepath.Join(dir, "catalog.sqlite"))
		if os.IsNotExist(err) {
			return out, false, nil
		}
		if err != nil {
			return nil, false, err
		}
		err = db.QueryRow(`SELECT call_seq,shard FROM calls WHERE call_id=?`, callID).Scan(&callSeq, &n)
		db.Close()
		if errors.Is(err, sql.ErrNoRows) {
			return out, false, nil
		}
		if err != nil {
			return nil, false, err
		}
	}
	db, err := readDB(shardPath(dir, n))
	if os.IsNotExist(err) {
		return out, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	defer db.Close()
	rows, err := db.Query(`SELECT seq,call_seq,call_id,time,direction,src,dst,raw,summary FROM messages WHERE call_seq=? AND seq>? ORDER BY seq LIMIT ?`, callSeq, after, limit+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
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

// Recover the catalog and sequence from committed shard data after an interrupted write.
func (w *Writer) recoverShards() error {
	paths, err := filepath.Glob(filepath.Join(w.dir, "shard-*.sqlite"))
	if err != nil {
		return err
	}
	for _, path := range paths {
		db, err := readDB(path)
		if err != nil {
			return err
		}
		var highest, count int64
		err = db.QueryRow(`SELECT COALESCE(MAX(seq),0),COUNT(*) FROM messages`).Scan(&highest, &count)
		if err != nil {
			db.Close()
			return err
		}
		if highest > w.nextMessage {
			w.nextMessage = highest
		}
		w.messages += count
		rows, err := db.Query(`SELECT call_id,call_seq,COUNT(*) FROM messages WHERE call_seq>0 GROUP BY call_id,call_seq`)
		if err != nil {
			db.Close()
			return err
		}
		tx, err := w.catalog.Begin()
		if err != nil {
			rows.Close()
			db.Close()
			return err
		}
		for rows.Next() {
			var id string
			var seq, n int64
			if err = rows.Scan(&id, &seq, &n); err != nil {
				break
			}
			_, err = tx.Exec(`INSERT INTO calls(call_id,call_seq,shard,messages) VALUES(?,?,?,?) ON CONFLICT(call_id) DO UPDATE SET messages=excluded.messages`, id, seq, shardFor(seq), n)
			if err != nil {
				break
			}
		}
		if err == nil {
			err = rows.Err()
		}
		rows.Close()
		db.Close()
		if err != nil {
			tx.Rollback()
			return err
		}
		if err = tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}
