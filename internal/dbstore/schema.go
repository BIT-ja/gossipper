package dbstore

import (
	"database/sql"
	"fmt"
)

// Separate names avoid touching business tables in a shared MySQL database.
var Tables = []string{"users", "jobs", "job_artifacts", "audit_log", "kv_settings"}

func Migrate(db *sql.DB) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS gossipper_users (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, username VARCHAR(191) COLLATE utf8mb4_unicode_ci NOT NULL UNIQUE,
 password_hash VARCHAR(255) NOT NULL, created_at VARCHAR(40) NOT NULL, role VARCHAR(32) NOT NULL DEFAULT 'admin'
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
		`CREATE TABLE IF NOT EXISTS gossipper_jobs (
 id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 profile_id VARCHAR(191), profile_kind VARCHAR(32) NOT NULL DEFAULT '', scenario_id VARCHAR(191),
 status VARCHAR(32) NOT NULL, args_json LONGTEXT NOT NULL, artifacts_dir TEXT NOT NULL,
 created_at VARCHAR(40) NOT NULL, started_at VARCHAR(40), finished_at VARCHAR(40), exit_code INT, error TEXT, created_by BIGINT, pid INT,
 INDEX idx_jobs_status(status), INDEX idx_jobs_profile(profile_id), INDEX idx_jobs_created_at(created_at)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
		`CREATE TABLE IF NOT EXISTS gossipper_job_artifacts (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, job_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 kind VARCHAR(64) NOT NULL, path TEXT NOT NULL, size_bytes BIGINT NOT NULL DEFAULT 0, created_at VARCHAR(40) NOT NULL,
 INDEX idx_artifacts_job(job_id), INDEX idx_artifacts_created(created_at),
 CONSTRAINT fk_gossipper_artifacts_job FOREIGN KEY(job_id) REFERENCES gossipper_jobs(id) ON DELETE CASCADE
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
		`CREATE TABLE IF NOT EXISTS gossipper_audit_log (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, ts VARCHAR(40) NOT NULL, user_id BIGINT, username VARCHAR(191),
 action VARCHAR(191) NOT NULL, target TEXT NOT NULL, payload_json LONGTEXT NOT NULL, INDEX idx_audit_ts(ts)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
		"CREATE TABLE IF NOT EXISTS gossipper_kv_settings (`key` VARCHAR(191) PRIMARY KEY, value LONGTEXT NOT NULL, updated_at VARCHAR(40) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin",
		`CREATE TABLE IF NOT EXISTS gossipper_sip_calls (
 job_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 call_hash BINARY(32) NOT NULL, call_id TEXT NOT NULL, call_seq BIGINT NOT NULL, messages BIGINT NOT NULL DEFAULT 0,
 PRIMARY KEY(job_id,call_hash), UNIQUE KEY idx_sip_calls_sequence(job_id,call_seq)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
		`CREATE TABLE IF NOT EXISTS gossipper_sip_messages (
 job_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 seq BIGINT NOT NULL, call_seq BIGINT NOT NULL, call_id TEXT NOT NULL, time VARCHAR(40) NOT NULL,
 direction VARCHAR(16) NOT NULL, src TEXT NOT NULL, dst TEXT NOT NULL, raw MEDIUMTEXT NOT NULL, summary TEXT NOT NULL,
 PRIMARY KEY(job_id,seq), INDEX idx_sip_messages_call(job_id,call_seq,seq)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
	}
	for _, q := range statements {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("MySQL schema: %w", err)
		}
	}
	return nil
}
