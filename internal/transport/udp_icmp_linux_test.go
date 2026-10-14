//go:build linux

package transport

import (
	"net"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestSharedUDPICMPReadErrorKeepsReceiving(t *testing.T) {
	s, err := NewSharedUDPWithReceivers("127.0.0.1:0", 1)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	// Enable delivery of a real ICMP error on this test socket. Production
	// behavior varies by OS/socket options; the receiver must survive when
	// ReadFromUDP returns the resulting ECONNREFUSED.
	raw, err := s.conns[0].SyscallConn()
	if err != nil {
		t.Fatal(err)
	}
	var sockErr error
	if err = raw.Control(func(fd uintptr) {
		sockErr = unix.SetsockoptInt(int(fd), unix.IPPROTO_IP, unix.IP_RECVERR, 1)
	}); err != nil {
		t.Fatal(err)
	}
	if sockErr != nil {
		t.Fatal(sockErr)
	}
	closedPeer, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.ParseIP("127.0.0.1")})
	if err != nil {
		t.Fatal(err)
	}
	addr := closedPeer.LocalAddr().(*net.UDPAddr)
	_ = closedPeer.Close()
	if _, err = s.conns[0].WriteToUDP([]byte("provoke ICMP port-unreachable"), addr); err != nil {
		t.Fatal(err)
	}
	select {
	case p, ok := <-s.Receive():
		if ok {
			p.Release()
		}
		t.Fatalf("ICMP error stopped UDP ingress (channel open=%v)", ok)
	case <-time.After(50 * time.Millisecond):
	}
	assertSharedUDPReceivesBYE(t, s)
}
