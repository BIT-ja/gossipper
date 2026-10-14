package transport

import (
	"fmt"
	"net"
	"testing"
	"time"
)

func TestSharedUDPReadTimeoutKeepsReceiving(t *testing.T) {
	s, err := NewSharedUDPWithReceivers("127.0.0.1:0", 1)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	// A recoverable read error must not permanently detach the SIP receiver.
	if err := s.conns[0].SetReadDeadline(time.Now()); err != nil {
		t.Fatal(err)
	}
	select {
	case p, ok := <-s.Receive():
		if ok {
			p.Release()
		}
		t.Fatalf("receiver stopped on read timeout (channel open=%v)", ok)
	case <-time.After(50 * time.Millisecond):
	}
	if err := s.conns[0].SetReadDeadline(time.Time{}); err != nil {
		t.Fatal(err)
	}
	assertSharedUDPReceivesBYE(t, s)
}

func TestSharedUDPOneReceiverCloseKeepsOtherReceivers(t *testing.T) {
	s, err := NewSharedUDPWithReceivers("127.0.0.1:0", 4)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	if s.ReceiverCount() < 2 {
		t.Skip("parallel UDP receivers unavailable")
	}
	if err := s.conns[0].Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case p, ok := <-s.Receive():
		if ok {
			p.Release()
		}
		t.Fatalf("one worker closed the shared ingress (channel open=%v)", ok)
	case <-time.After(50 * time.Millisecond):
	}
	assertSharedUDPReceivesBYE(t, s)
}

func TestSharedUDPCloseWhileReceiving(t *testing.T) {
	s, err := NewSharedUDPWithReceivers("127.0.0.1:0", 4)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	peer, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.ParseIP("127.0.0.1")})
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	addr := &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: s.LocalPort()}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 100; i++ {
			_, _ = peer.WriteToUDP([]byte("SIP packet during shutdown"), addr)
			time.Sleep(100 * time.Microsecond)
		}
	}()
	time.Sleep(5 * time.Millisecond)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	for p := range s.Receive() {
		p.Release()
	}
	<-done
	if err := s.Send([]byte("after close"), addr); err == nil {
		t.Fatal("send succeeded after close")
	}
}

func assertSharedUDPReceivesBYE(t *testing.T, s *SharedUDP) {
	t.Helper()
	peer, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.ParseIP("127.0.0.1")})
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	addr := &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: s.LocalPort()}
	payload := []byte(fmt.Sprintf("BYE sip:gossip@127.0.0.1:%d SIP/2.0\r\nCall-ID: gossip-1-1-d6ad1395-0001\r\nCSeq: 121428717 BYE\r\nContent-Length: 0\r\n\r\n", s.LocalPort()))
	if _, err := peer.WriteToUDP(payload, addr); err != nil {
		t.Fatal(err)
	}
	select {
	case p, ok := <-s.Receive():
		if !ok {
			t.Fatal("UDP ingress closed before BYE")
		}
		defer p.Release()
		if string(p.Data) != string(payload) {
			t.Fatalf("unexpected datagram: %q", p.Data)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("BYE was not delivered after receiver error")
	}
}
