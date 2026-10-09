package transport

import (
	"net"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestSIPObserverSeesDatagramsBeforeConsumerAndFullPayload(t *testing.T) {
	seen := make(chan string, 4)
	s, err := NewSharedUDPWithReceivers("127.0.0.1:0", 1, func(direction, src, dst string, raw []byte) { seen <- direction + ":" + string(raw) })
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	conn, err := net.Dial("udp", net.JoinHostPort("127.0.0.1", strconv.Itoa(s.LocalPort())))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	payload := "SIP/2.0 200 OK\r\nCall-ID: full-0001\r\n\r\n" + strings.Repeat("x", 9000)
	for i := 0; i < 2; i++ {
		if _, err = conn.Write([]byte(payload)); err != nil {
			t.Fatal(err)
		}
		select {
		case got := <-seen:
			if got != "recv:"+payload {
				t.Fatal("truncated or changed capture")
			}
		case <-time.After(time.Second):
			t.Fatal("observer depended on scenario consumer")
		}
	}
	// Drain before closing; two identical datagrams must be two observations.
	for i := 0; i < 2; i++ {
		p := <-s.Receive()
		p.Release()
	}
}
