package engine

import (
	"fmt"
	"github.com/sipcapture/gossipper/internal/transport"
)

func (e *Engine) newCapturedCallID(n int) string {
	id := fmt.Sprintf("%s-%04d", newCallID(n), n)
	if e.cfg.SIPCapture != nil {
		e.cfg.SIPCapture.Register(id, int64(n))
	}
	return id
}
func (e *Engine) captureObserver() transport.SIPObserver {
	if e.cfg.SIPCapture == nil {
		return nil
	}
	return e.cfg.SIPCapture.Record
}
