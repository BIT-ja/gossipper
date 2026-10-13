package uistore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// Import a legacy data directory only once per database. The marker and all
// imported objects commit together. Retained files are backups, never fallback
// reads; otherwise deletion in the UI could resurrect stale objects on restart.
func (s *Store) importFilesOnce(ctx context.Context) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `INSERT INTO gossipper_ui_objects(kind,id,revision,payload) VALUES('migration','files-v1','','pending') ON DUPLICATE KEY UPDATE id=id`)
	if err != nil {
		return err
	}
	raw, err := lockedObject(ctx, tx, "migration", "files-v1")
	if err != nil {
		return err
	}
	if string(raw) == "complete" {
		return tx.Commit()
	}
	local := &Store{layout: s.layout, now: s.now, scenarioHistoryKeep: s.scenarioHistoryKeep}
	insert := func(kind, id, revision string, value any) error {
		if err := validObject(id, revision, kind == "history"); err != nil {
			return err
		}
		err := writeObject(ctx, tx, kind, id, revision, value, false)
		if errors.Is(err, ErrConflict) {
			return nil
		}
		return err
	}
	clients, err := local.ListClientProfiles()
	if err != nil {
		return err
	}
	for _, p := range clients {
		if err = insert("client", p.ID, "", p); err != nil {
			return fmt.Errorf("import client %s: %w", p.ID, err)
		}
	}
	servers, err := local.ListServerProfiles()
	if err != nil {
		return err
	}
	for _, p := range servers {
		if err = insert("server", p.ID, "", p); err != nil {
			return fmt.Errorf("import server %s: %w", p.ID, err)
		}
	}
	scenarios, err := local.ListScenarios()
	if err != nil {
		return err
	}
	for _, m := range scenarios {
		// Existing database scenarios and their history are authoritative.
		_, err = lockedObject(ctx, tx, "scenario", m.ID)
		if err == nil {
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		body, e := local.GetScenario(m.ID)
		if e != nil {
			return e
		}
		if err = insert("scenario", m.ID, "", body); err != nil {
			return err
		}
		history, e := local.ListScenarioHistory(m.ID)
		if e != nil {
			return e
		}
		for _, h := range history {
			body, e = local.GetScenarioHistory(m.ID, h.TS)
			if e != nil {
				return e
			}
			if err = insert("history", m.ID, h.TS, body); err != nil {
				return err
			}
		}
	}
	_, err = tx.ExecContext(ctx, `UPDATE gossipper_ui_objects SET payload='complete' WHERE kind='migration' AND id='files-v1' AND revision=''`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
