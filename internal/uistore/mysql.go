package uistore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/sipcapture/gossipper/internal/dbstore"
)

const uiObjectsDDL = `CREATE TABLE IF NOT EXISTS gossipper_ui_objects (
 kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 revision VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
 payload LONGTEXT NOT NULL,
 PRIMARY KEY(kind,id,revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`

// Close releases database connections; file-only stores need no cleanup.
func (s *Store) Close() error {
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

func (s *Store) openMySQL() error {
	db, err := dbstore.Open()
	if err != nil {
		return err
	}
	s.db = db
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err = db.ExecContext(ctx, uiObjectsDDL); err == nil {
		err = s.importFilesOnce(ctx)
	}
	if err != nil {
		db.Close()
		s.db = nil
		return fmt.Errorf("uistore MySQL: %w", err)
	}
	return nil
}

func mysqlConflict(err error) error {
	var e *mysql.MySQLError
	if errors.As(err, &e) && e.Number == 1062 {
		return ErrConflict
	}
	return err
}
func validObject(id, revision string, history bool) error {
	if !isSafeID(id) {
		return ErrInvalidID
	}
	if history && !isSafeHistoryTS(revision) {
		return ErrInvalidHistoryTS
	}
	return nil
}
func mysqlGet[T any](s *Store, kind, id, revision string) (T, error) {
	var out T
	if err := validObject(id, revision, kind == "history"); err != nil {
		return out, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var raw []byte
	err := s.db.QueryRowContext(ctx, `SELECT payload FROM gossipper_ui_objects WHERE kind=? AND id=? AND revision=?`, kind, id, revision).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	err = json.Unmarshal(raw, &out)
	return out, err
}
func mysqlList[T any](s *Store, kind string) ([]T, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	rows, err := s.db.QueryContext(ctx, `SELECT payload FROM gossipper_ui_objects WHERE kind=? AND revision='' ORDER BY id`, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []T{}
	for rows.Next() {
		var raw []byte
		var item T
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(raw, &item); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
func lockedObject(ctx context.Context, tx *sql.Tx, kind, id string) ([]byte, error) {
	var raw []byte
	err := tx.QueryRowContext(ctx, `SELECT payload FROM gossipper_ui_objects WHERE kind=? AND id=? AND revision='' FOR UPDATE`, kind, id).Scan(&raw)
	return raw, err
}
func writeObject(ctx context.Context, tx *sql.Tx, kind, id, revision string, value any, exists bool) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if exists {
		_, err = tx.ExecContext(ctx, `UPDATE gossipper_ui_objects SET payload=? WHERE kind=? AND id=? AND revision=?`, raw, kind, id, revision)
	} else {
		_, err = tx.ExecContext(ctx, `INSERT INTO gossipper_ui_objects(kind,id,revision,payload) VALUES(?,?,?,?)`, kind, id, revision, raw)
	}
	return mysqlConflict(err)
}
func (s *Store) mysqlPutProfile(kind, id string, name *string, created, updated *time.Time, value any, create bool) error {
	if !isSafeID(id) {
		return ErrInvalidID
	}
	*name = strings.TrimSpace(*name)
	if *name == "" {
		*name = id
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	prior, err := lockedObject(ctx, tx, kind, id)
	exists := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if exists && create {
		return ErrConflict
	}
	if created.IsZero() {
		if exists {
			var old struct {
				CreatedAt time.Time `json:"created_at"`
			}
			if err = json.Unmarshal(prior, &old); err != nil {
				return err
			}
			*created = old.CreatedAt
		} else {
			*created = s.now()
		}
	}
	*updated = s.now()
	if err = writeObject(ctx, tx, kind, id, "", value, exists); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) mysqlPutScenario(meta ScenarioMeta, xml string, create bool) (ScenarioBody, error) {
	if !isSafeID(meta.ID) {
		return ScenarioBody{}, ErrInvalidID
	}
	if strings.TrimSpace(xml) == "" {
		return ScenarioBody{}, errors.New("uistore: scenario XML is empty")
	}
	meta.Name = strings.TrimSpace(meta.Name)
	if meta.Name == "" {
		meta.Name = meta.ID
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ScenarioBody{}, err
	}
	defer tx.Rollback()
	raw, err := lockedObject(ctx, tx, "scenario", meta.ID)
	exists := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return ScenarioBody{}, err
	}
	if exists && create {
		return ScenarioBody{}, ErrConflict
	}
	now := s.now()
	if exists {
		var prior ScenarioBody
		if err = json.Unmarshal(raw, &prior); err != nil {
			return ScenarioBody{}, err
		}
		if meta.CreatedAt.IsZero() {
			meta.CreatedAt = prior.Meta.CreatedAt
		}
		if prior.XML != xml {
			// Preserve unique revisions even if the clock repeats at nanosecond precision.
			stamp := now
			for {
				err = writeObject(ctx, tx, "history", meta.ID, stamp.UTC().Format(historyTSFormat), prior, false)
				if !errors.Is(err, ErrConflict) {
					break
				}
				stamp = stamp.Add(time.Nanosecond)
			}
			if err != nil {
				return ScenarioBody{}, err
			}
			if err = s.mysqlPruneHistory(ctx, tx, meta.ID); err != nil {
				return ScenarioBody{}, err
			}
		}
	} else if meta.CreatedAt.IsZero() {
		meta.CreatedAt = now
	}
	meta.UpdatedAt = now
	body := ScenarioBody{Meta: meta, XML: xml}
	if err = writeObject(ctx, tx, "scenario", meta.ID, "", body, exists); err != nil {
		return ScenarioBody{}, err
	}
	return body, tx.Commit()
}
func (s *Store) mysqlPruneHistory(ctx context.Context, tx *sql.Tx, id string) error {
	if s.scenarioHistoryKeep <= 0 {
		return nil
	}
	rows, err := tx.QueryContext(ctx, `SELECT revision FROM gossipper_ui_objects WHERE kind='history' AND id=? ORDER BY revision DESC`, id)
	if err != nil {
		return err
	}
	var stamps []string
	for rows.Next() {
		var ts string
		if err = rows.Scan(&ts); err != nil {
			rows.Close()
			return err
		}
		stamps = append(stamps, ts)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for i := s.scenarioHistoryKeep; i < len(stamps); i++ {
		if _, err = tx.ExecContext(ctx, `DELETE FROM gossipper_ui_objects WHERE kind='history' AND id=? AND revision=?`, id, stamps[i]); err != nil {
			return err
		}
	}
	return nil
}
func (s *Store) mysqlDelete(kind, id, revision string) error {
	if err := validObject(id, revision, kind == "history"); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `DELETE FROM gossipper_ui_objects WHERE kind=? AND id=? AND revision=?`, kind, id, revision)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	if kind == "scenario" {
		if _, err = tx.ExecContext(ctx, `DELETE FROM gossipper_ui_objects WHERE kind='history' AND id=?`, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (s *Store) mysqlHistory(id string) ([]ScenarioHistoryEntry, error) {
	if _, err := mysqlGet[ScenarioBody](s, "scenario", id, ""); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	rows, err := s.db.QueryContext(ctx, `SELECT revision,payload FROM gossipper_ui_objects WHERE kind='history' AND id=? ORDER BY revision DESC`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ScenarioHistoryEntry{}
	for rows.Next() {
		var ts string
		var raw []byte
		var body ScenarioBody
		if err = rows.Scan(&ts, &raw); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(raw, &body); err != nil {
			return nil, err
		}
		when, e := time.Parse(historyTSFormat, ts)
		if e != nil {
			return nil, e
		}
		out = append(out, ScenarioHistoryEntry{TS: ts, Timestamp: when, SizeBytes: int64(len(body.XML)), Meta: body.Meta})
	}
	return out, rows.Err()
}
