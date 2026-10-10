package v2

import (
	"encoding/json"
	"github.com/sipcapture/gossipper/internal/sipcapture"
	"github.com/sipcapture/gossipper/internal/supervisor"
	"github.com/sipcapture/gossipper/internal/timefmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

func (s *Server) captureJob(w http.ResponseWriter, r *http.Request) (supervisor.Job, bool) {
	if !s.requireRegistry(w) {
		return supervisor.Job{}, false
	}
	j, err := s.cfg.Registry.Store.Get(r.Context(), pathID(r))
	if err != nil {
		s.writeError(w, 404, "job not found")
		return j, false
	}
	return j, true
}
func (s *Server) handleSIPCapture(w http.ResponseWriter, r *http.Request) {
	j, ok := s.captureJob(w, r)
	if !ok {
		return
	}
	cfg := supervisor.ReadCaptureConfig(j.ArtifactsDir)
	state := map[string]any{"enabled": cfg.Enabled, "retention_days": cfg.RetentionDays, "status": "disabled", "dropped": 0, "messages": 0}
	if cfg.Enabled {
		state["status"] = "pending"
		v, err := sipcapture.Status(filepath.Join(j.ArtifactsDir, "sip-capture"))
		if err == nil {
			for k, x := range v {
				if k == "enabled" || (k == "status" && x == "disabled") {
					continue
				}
				state[k] = x
			}
		} else if !os.IsNotExist(err) {
			state["error"] = err.Error()
			state["status"] = "error"
		}
		if j.FinishedAt != nil {
			state["expires_at"] = timefmt.Format(j.FinishedAt.Add(time.Duration(cfg.RetentionDays) * 24 * time.Hour))
			if state["status"] == "recording" || state["status"] == "pending" {
				state["status"] = "interrupted"
			}
		}
		if supervisor.CaptureExpired(j, time.Now()) {
			state["status"] = "expired"
		}
	}
	s.writeJSON(w, 200, state)
}
func captureCursor(r *http.Request) (int64, int) {
	after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	if after < 0 {
		after = 0
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 1000 {
		limit = 200
	}
	return after, limit
}
func (s *Server) captureReadable(w http.ResponseWriter, r *http.Request) (string, bool) {
	j, ok := s.captureJob(w, r)
	if !ok {
		return "", false
	}
	if !supervisor.ReadCaptureConfig(j.ArtifactsDir).Enabled {
		s.writeError(w, 409, "该任务未开启信令采集")
		return "", false
	}
	if supervisor.CaptureExpired(j, time.Now()) {
		s.writeError(w, 410, "信令已过期")
		return "", false
	}
	return filepath.Join(j.ArtifactsDir, "sip-capture"), true
}
func (s *Server) handleSIPMessages(w http.ResponseWriter, r *http.Request) {
	dir, ok := s.captureReadable(w, r)
	if !ok {
		return
	}
	after, limit := captureCursor(r)
	messages, more, err := sipcapture.ReadMessages(dir, r.URL.Query().Get("call_id"), after, limit)
	if err != nil {
		s.writeError(w, 500, err.Error())
		return
	}
	if messages == nil {
		messages = []sipcapture.Message{}
	}
	next := after
	if len(messages) > 0 {
		next = messages[len(messages)-1].Seq
	}
	s.writeJSON(w, 200, map[string]any{"messages": messages, "has_more": more, "next_cursor": next})
}
func (s *Server) handleSIPCalls(w http.ResponseWriter, r *http.Request) {
	dir, ok := s.captureReadable(w, r)
	if !ok {
		return
	}
	after, limit := captureCursor(r)
	calls, more, err := sipcapture.ListCalls(dir, after, limit)
	if err != nil {
		s.writeError(w, 500, err.Error())
		return
	}
	if calls == nil {
		calls = []sipcapture.Call{}
	}
	next := after
	if len(calls) > 0 {
		next = calls[len(calls)-1].CallSeq
	}
	s.writeJSON(w, 200, map[string]any{"calls": calls, "has_more": more, "next_cursor": next})
}
func (s *Server) handleSIPExport(w http.ResponseWriter, r *http.Request) {
	dir, ok := s.captureReadable(w, r)
	if !ok {
		return
	}
	// Single-call export is streamed, never loaded fully into memory.
	id := r.URL.Query().Get("call_id")
	w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="sip-trace.jsonl"`)
	enc := json.NewEncoder(w)
	emit := func(id string) bool {
		var after int64
		for {
			if r.Context().Err() != nil {
				return false
			}
			rows, more, err := sipcapture.ReadMessages(dir, id, after, 1000)
			if err != nil {
				_ = enc.Encode(map[string]string{"export_error": err.Error()})
				return false
			}
			for _, row := range rows {
				if enc.Encode(row) != nil {
					return false
				}
				after = row.Seq
			}
			if !more {
				return true
			}
		}
	}
	if r.URL.Query().Has("call_id") {
		emit(id)
		return
	}
	var after int64
	for {
		calls, more, err := sipcapture.ListCalls(dir, after, 200)
		if err != nil {
			_ = enc.Encode(map[string]string{"export_error": err.Error()})
			return
		}
		for _, c := range calls {
			if !emit(c.CallID) {
				return
			}
			after = c.CallSeq
		}
		if !more {
			break
		}
	}
	emit("")
}
